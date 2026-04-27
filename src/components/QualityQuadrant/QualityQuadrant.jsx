// Channel Quality Quadrant
//
// A 4-quadrant scatter chart that maps every traffic source onto:
//   X = volume (sessions, log-scaled when range is wide)
//   Y = engagement quality score (0-100)
// with median splits for the cutoffs. Each quadrant has a meaning:
//   Premium / Scale Opportunity / Volume Leak / Marginal.
//
// GA4 doesn't show this — its acquisition reports are 1-D tables. This
// view tells the reader at a glance which channels are "the ones to feed"
// and which are bleeding sessions.

import {
  CartesianGrid,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  Cell,
} from 'recharts';

import { ChartWrapper } from '../ChartWrapper/ChartWrapper.jsx';
import { formatInteger, formatPercent } from '../../lib/formatters.js';

const QUAD_COLORS = {
  premium: '#16a34a',
  scale: '#2563eb',
  leak: '#dc2626',
  marginal: '#9ca3af',
};

const QUAD_LABEL = {
  premium: 'Premium',
  scale: 'Scale',
  leak: 'Leak',
  marginal: 'Marginal',
};

function CustomTooltip({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="quad-tooltip">
      <p className="quad-tooltip__title">{p.name}</p>
      <p className="quad-tooltip__row">
        Sessions: <strong>{formatInteger(p.sessions)}</strong>
      </p>
      <p className="quad-tooltip__row">
        EQS: <strong>{p.engagement_quality_score}</strong>
      </p>
      <p className="quad-tooltip__row">
        Engagement: <strong>{formatPercent(p.engagement_rate, 0)}</strong>
      </p>
      <p className={`quad-tooltip__pill quad-tooltip__pill--${p.quadrant}`}>
        {QUAD_LABEL[p.quadrant]}
      </p>
    </div>
  );
}

export function QualityQuadrant({ quadrant, title = 'Channel Quality Map', subtitle, dimLabel = 'channel' }) {
  if (!quadrant || !quadrant.items || quadrant.items.length === 0) return null;

  const { items, cutoffs, defs, counts, totals } = quadrant;
  const totalSessions = items.reduce((acc, i) => acc + i.sessions, 0) || 1;

  return (
    <>
      <ChartWrapper title={title} subtitle={subtitle || 'Each dot is one ' + dimLabel + '. Median splits draw the quadrants.'} height={340}>
        <ScatterChart margin={{ top: 16, right: 24, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
          <XAxis
            dataKey="sessions"
            type="number"
            name="Sessions"
            stroke="#6b7280"
            tickFormatter={(v) => formatInteger(v)}
            domain={['auto', 'auto']}
          />
          <YAxis
            dataKey="engagement_quality_score"
            type="number"
            name="EQS"
            stroke="#6b7280"
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
          />
          <ZAxis dataKey="sessions" range={[60, 320]} />
          <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3' }} />
          <ReferenceLine
            x={cutoffs.sessions}
            stroke="#9ca3af"
            strokeDasharray="4 4"
            label={{ value: 'volume median', position: 'top', fill: '#6b7280', fontSize: 11 }}
          />
          <ReferenceLine
            y={cutoffs.quality}
            stroke="#9ca3af"
            strokeDasharray="4 4"
            label={{ value: 'quality median', position: 'right', fill: '#6b7280', fontSize: 11 }}
          />
          <Scatter data={items} fill="#522e91">
            {items.map((entry, idx) => (
              <Cell key={idx} fill={QUAD_COLORS[entry.quadrant]} />
            ))}
          </Scatter>
        </ScatterChart>
      </ChartWrapper>
      <div className="quad-legend">
        {(['premium', 'scale', 'leak', 'marginal']).map((key) => (
          <div key={key} className={`quad-legend__card quad-legend__card--${key}`}>
            <div className="quad-legend__head">
              <span className={`quad-legend__dot quad-legend__dot--${key}`} aria-hidden="true" />
              <span className="quad-legend__name">{defs[key].label}</span>
              <span className="quad-legend__count">{counts[key] || 0}</span>
            </div>
            <p className="quad-legend__copy">{defs[key].summary}</p>
            <p className="quad-legend__share">
              <strong>{formatPercent((totals[key] || 0) / totalSessions, 0)}</strong> of sessions
            </p>
          </div>
        ))}
      </div>
    </>
  );
}
