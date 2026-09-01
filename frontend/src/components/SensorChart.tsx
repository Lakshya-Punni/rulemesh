import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export interface SensorSample {
  t: number; // seconds since chart mount, monotonic, only for x-axis ordering
  smoke: number;
  temperature: number;
}

interface SensorChartProps {
  zoneLabel: string;
  samples: SensorSample[];
}

// Plan hours 9-11 (Person B): "Update charts no faster than ten times per
// second. Render only the selected zone's charts." The <=10Hz constraint is
// satisfied upstream in App.tsx (samples are appended once per 100ms tick,
// i.e. exactly 10Hz, never faster), and this component only ever receives
// the currently selected zone's data — never all five zones at once.
export function SensorChart({ zoneLabel, samples }: SensorChartProps) {
  return (
    <div className="panel">
      <div className="panel__title">
        Sensor trend
        <span className="panel__title-badge">{zoneLabel}</span>
      </div>
      {samples.length < 2 ? (
        <div className="empty-note">Start the simulation to see live sensor trends.</div>
      ) : (
        <div style={{ width: "100%", height: 140 }}>
          <ResponsiveContainer>
            <LineChart data={samples} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
              <CartesianGrid stroke="#1c222b" vertical={false} />
              <XAxis dataKey="t" hide />
              <YAxis
                width={36}
                tick={{ fontSize: 10, fill: "var(--text-faint)" }}
                stroke="var(--border-strong)"
              />
              <Tooltip
                contentStyle={{
                  background: "var(--panel-raised)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 11,
                }}
                labelFormatter={() => ""}
              />
              <Line
                type="monotone"
                dataKey="smoke"
                stroke="var(--accent-red)"
                dot={false}
                strokeWidth={1.5}
                isAnimationActive={false}
                name="Smoke %"
              />
              <Line
                type="monotone"
                dataKey="temperature"
                stroke="var(--accent-cyan)"
                dot={false}
                strokeWidth={1.5}
                isAnimationActive={false}
                name="Temp °C"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div style={{ display: "flex", gap: 14, fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
        <span>
          <span style={{ color: "var(--accent-red)" }}>●</span> smoke
        </span>
        <span>
          <span style={{ color: "var(--accent-cyan)" }}>●</span> temperature
        </span>
      </div>
    </div>
  );
}
