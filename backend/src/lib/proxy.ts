// Управление прокси для исходящих запросов к Voicer / fast-gen.
//
// Хранится в таблице Setting (key='proxy'). Поддерживаем три протокола:
//   - socks5  → используем пакет `socks` для SOCKS-туннеля
//   - http    → undici ProxyAgent (CONNECT-туннель в открытом виде)
//   - https   → то же, но TLS до прокси (uri начинается с https://)
//
// Все наружные клиенты должны звать proxyFetch() вместо global fetch,
// а места, где используется node:https.request напрямую (fastgen
// download через downloadRange), — getHttpsAgent().

import { ProxyAgent, Agent as UndiciAgent, Dispatcher, fetch as undiciFetch } from 'undici';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksClient } from 'socks';
import * as tls from 'node:tls';
import type { Agent as HttpAgent } from 'node:http';
import { prisma } from '../db.js';

export type ProxyProtocol = 'socks5' | 'http' | 'https';

export interface ProxyConfig {
  enabled: boolean;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

const DEFAULT_CONFIG: ProxyConfig = {
  enabled: false,
  protocol: 'socks5',
  host: '',
  port: 1080,
  username: '',
  password: '',
};

let current: ProxyConfig = { ...DEFAULT_CONFIG };
let dispatcher: Dispatcher | null = null;
let httpsAgent: HttpAgent | null = null;

function buildUrl(cfg: ProxyConfig): string {
  const auth = cfg.username
    ? `${encodeURIComponent(cfg.username)}:${encodeURIComponent(cfg.password ?? '')}@`
    : '';
  return `${cfg.protocol}://${auth}${cfg.host}:${cfg.port}`;
}

function makeSocksDispatcher(cfg: ProxyConfig): Dispatcher {
  // undici Agent с кастомным connect-хуком: открываем TCP-туннель через
  // SOCKS5, а если целевой URL HTTPS — оборачиваем в tls.connect().
  return new UndiciAgent({
    connect: async (opts: any, callback: (err: Error | null, socket: any) => void) => {
      try {
        const { socket } = await SocksClient.createConnection({
          proxy: {
            host: cfg.host,
            port: cfg.port,
            type: 5,
            userId: cfg.username || undefined,
            password: cfg.password || undefined,
          },
          command: 'connect',
          destination: {
            host: opts.hostname,
            port: opts.port ? Number(opts.port) : opts.protocol === 'https:' ? 443 : 80,
          },
          timeout: 15_000,
        });
        if (opts.protocol === 'https:') {
          const tlsSock = tls.connect({
            socket,
            servername: opts.servername || opts.hostname,
            ALPNProtocols: opts.ALPNProtocols,
            rejectUnauthorized: opts.rejectUnauthorized !== false,
          });
          tlsSock.once('secureConnect', () => callback(null, tlsSock));
          tlsSock.once('error', (err) => callback(err, null));
        } else {
          callback(null, socket);
        }
      } catch (err: any) {
        callback(err, null);
      }
    },
  });
}

function rebuildAgents(cfg: ProxyConfig) {
  if (!cfg.enabled || !cfg.host) {
    dispatcher = null;
    httpsAgent = null;
    return;
  }
  const url = buildUrl(cfg);
  if (cfg.protocol === 'socks5') {
    dispatcher = makeSocksDispatcher(cfg);
    httpsAgent = new SocksProxyAgent(url) as unknown as HttpAgent;
  } else {
    dispatcher = new ProxyAgent({ uri: url });
    httpsAgent = new HttpsProxyAgent(url) as unknown as HttpAgent;
  }
}

/** Текущая конфигурация (включая пароль — отдаём только в админ-эндпоинте). */
export function getConfig(): ProxyConfig {
  return { ...current };
}

/** Загрузить из БД при старте. */
export async function loadFromDb(): Promise<void> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: 'proxy' } });
    if (row?.value && typeof row.value === 'object') {
      const v = row.value as Partial<ProxyConfig>;
      current = {
        enabled: Boolean(v.enabled),
        protocol: (['socks5', 'http', 'https'].includes(v.protocol as string)
          ? v.protocol
          : 'socks5') as ProxyProtocol,
        host: String(v.host ?? ''),
        port: Number(v.port ?? 1080),
        username: typeof v.username === 'string' ? v.username : '',
        password: typeof v.password === 'string' ? v.password : '',
      };
      rebuildAgents(current);
      if (current.enabled && current.host) {
        console.log(
          `🌐 Прокси активен: ${current.protocol}://${current.host}:${current.port}` +
            (current.username ? ' (с авторизацией)' : ''),
        );
      }
    }
  } catch (e: any) {
    console.warn('Не удалось загрузить настройки прокси:', e?.message ?? e);
  }
}

/** Сохранить новую конфигурацию (применяется мгновенно). */
export async function saveConfig(patch: Partial<ProxyConfig>): Promise<ProxyConfig> {
  const next: ProxyConfig = {
    enabled: patch.enabled ?? current.enabled,
    protocol: (patch.protocol ?? current.protocol) as ProxyProtocol,
    host: (patch.host ?? current.host ?? '').trim(),
    port: Number(patch.port ?? current.port) || 0,
    username: (patch.username ?? current.username ?? '').trim(),
    password: patch.password ?? current.password ?? '',
  };
  if (!['socks5', 'http', 'https'].includes(next.protocol)) {
    throw new Error('Неизвестный протокол прокси (нужно socks5, http или https)');
  }
  if (next.enabled) {
    if (!next.host) throw new Error('Укажи host прокси');
    if (!next.port || next.port < 1 || next.port > 65535) {
      throw new Error('Порт прокси должен быть 1–65535');
    }
  }
  await prisma.setting.upsert({
    where: { key: 'proxy' },
    update: { value: next as any },
    create: { key: 'proxy', value: next as any },
  });
  current = next;
  rebuildAgents(current);
  return { ...current };
}

/** Построить агенты (dispatcher для undici + http.Agent для node:https) для
 *  ПЕРЕДАННОЙ конфигурации, не трогая глобальное состояние. Используется для
 *  per-request override (например, проверка прокси из админ-UI). */
export function buildAgents(cfg: ProxyConfig): { dispatcher: Dispatcher | null; httpsAgent: HttpAgent | null } {
  if (!cfg.enabled || !cfg.host) return { dispatcher: null, httpsAgent: null };
  const url = buildUrl(cfg);
  if (cfg.protocol === 'socks5') {
    return {
      dispatcher: makeSocksDispatcher(cfg),
      httpsAgent: new SocksProxyAgent(url) as unknown as HttpAgent,
    };
  }
  return {
    dispatcher: new ProxyAgent({ uri: url }),
    httpsAgent: new HttpsProxyAgent(url) as unknown as HttpAgent,
  };
}

/** fetch с учётом прокси. Если передан override — используется он
 *  (без мутации глобального состояния), иначе текущий конфиг. */
export async function proxyFetch(
  input: string | URL,
  init: any = {},
  override?: { dispatcher?: Dispatcher | null },
): Promise<Response> {
  const disp = override ? override.dispatcher : dispatcher;
  if (disp) {
    return (undiciFetch as any)(input, { ...init, dispatcher: disp }) as unknown as Response;
  }
  return fetch(input, init);
}

/** true если прокси сейчас активен (для UI/диагностики). */
export function isActive(): boolean {
  return Boolean(dispatcher);
}

/** http.Agent для node:https.request (используется в fastgen storage-download). */
export function getHttpsAgent(): HttpAgent | null {
  return httpsAgent;
}

/** Проверить связь с произвольным URL через текущий (или временный) прокси. */
export async function testProxy(
  targetUrl: string,
  override?: Partial<ProxyConfig>,
): Promise<{ ok: boolean; status?: number; latencyMs: number; error?: string }> {
  let testDispatcher: Dispatcher | null = dispatcher;
  if (override) {
    const cfg: ProxyConfig = {
      enabled: true,
      protocol: (override.protocol ?? current.protocol) as ProxyProtocol,
      host: (override.host ?? current.host ?? '').trim(),
      port: Number(override.port ?? current.port) || 0,
      username: override.username ?? current.username ?? '',
      password: override.password ?? current.password ?? '',
    };
    if (!cfg.host || !cfg.port) {
      return { ok: false, latencyMs: 0, error: 'host/port не заданы' };
    }
    if (cfg.protocol === 'socks5') {
      testDispatcher = makeSocksDispatcher(cfg);
    } else {
      testDispatcher = new ProxyAgent({ uri: buildUrl(cfg) });
    }
  }
  const t0 = Date.now();
  try {
    const r: any = await (undiciFetch as any)(targetUrl, {
      method: 'GET',
      dispatcher: testDispatcher ?? undefined,
      signal: AbortSignal.timeout(25_000),
    });
    // Даже если статус не 2xx — это значит, что прокси прошёл и API ответил.
    // Возвращаем ok=true, чтобы пользователь видел "соединение работает".
    return { ok: true, status: r.status, latencyMs: Date.now() - t0 };
  } catch (e: any) {
    const code = e?.cause?.code || e?.code;
    const inner = e?.cause?.message || e?.message;
    const parts = [code, inner].filter(Boolean);
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      error: parts.length ? parts.join(' · ') : String(e),
    };
  }
}
