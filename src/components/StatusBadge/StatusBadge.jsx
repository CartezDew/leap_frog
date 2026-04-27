import { botLabel, bounceClass, bounceLabel } from '../../lib/formatters.js';

const BOT_TONE = {
  confirmed_bot: 'red',
  likely_bot: 'amber',
  suspicious: 'yellow',
  human: 'green',
};

export function BotBadge({ classification }) {
  const tone = BOT_TONE[classification] || 'neutral';
  return <span className={`pill pill--${tone}`}>{botLabel(classification)}</span>;
}

const BOUNCE_TONE = {
  'bounce-high': 'red',
  'bounce-medium': 'amber',
  'bounce-good': 'green',
  'bounce-okay': 'neutral',
};

export function BounceBadge({ value }) {
  const cls = bounceClass(value);
  return <span className={`pill pill--${BOUNCE_TONE[cls]}`}>{bounceLabel(value)}</span>;
}

export function PriorityBadge({ priority }) {
  const tone =
    priority === 'high'
      ? 'red'
      : priority === 'medium'
        ? 'amber'
        : priority === 'low'
          ? 'green'
          : 'purple';
  const label =
    priority === 'high'
      ? 'High'
      : priority === 'medium'
        ? 'Medium'
        : priority === 'low'
          ? 'Low'
          : 'Info';
  return <span className={`pill pill--${tone}`}>{label}</span>;
}
