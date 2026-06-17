export default function Timeline({ scenes }) {
  if (!scenes || scenes.length === 0) return null;
  const lengths = scenes.map((s) => Math.max(s.voiceText?.length || 1, 1));
  const total = lengths.reduce((a, b) => a + b, 0);

  return (
    <div className="timeline" title="Примерная длительность каждой сцены (пропорционально тексту)">
      {scenes.map((s, i) => (
        <div
          key={s.id}
          className="timeline-seg"
          style={{ flex: lengths[i] / total }}
          title={`Сцена ${i + 1}: ~${Math.round((lengths[i] / total) * 100)}%`}
        >
          {lengths[i] / total > 0.06 ? i + 1 : ''}
        </div>
      ))}
    </div>
  );
}
