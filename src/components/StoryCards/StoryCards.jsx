// Story-telling callout cards used at the top of dashboard pages to give the
// reader an at-a-glance narrative before they dive into the detail tables.
//
// Each card has a tone (purple | green | amber | red | info), an icon, a small
// label, a big headline value, a sentence-length narrative, and a footer line
// that usually expresses share / context for the headline number.
//
// Cards are passed in via the `cards` prop so this component stays reusable —
// the page that hosts it owns the logic that turns analyzer output into
// human-readable story copy.

export function StoryCards({ cards, columns = 4, eyebrow, title, ariaLabel }) {
  if (!Array.isArray(cards) || cards.length === 0) return null;

  const label =
    ariaLabel ||
    (typeof eyebrow === 'string' && eyebrow) ||
    (typeof title === 'string' && title) ||
    'Story cards';

  return (
    <section className="story-cards" aria-label={label}>
      {(eyebrow || title) && (
        <header className="story-cards__head">
          {eyebrow && <p className="story-cards__eyebrow">{eyebrow}</p>}
          {title && <h2 className="story-cards__title">{title}</h2>}
        </header>
      )}
      <div
        className={`story-cards__grid story-cards__grid--cols-${columns}`}
      >
        {cards.map((card, idx) => {
          const tone = card.tone || 'purple';
          const Icon = card.icon || null;
          return (
            <article
              key={card.id || idx}
              className={`story-card story-card--${tone}`}
            >
              <header className="story-card__head">
                {Icon && (
                  <span className="story-card__icon" aria-hidden="true">
                    <Icon size={16} />
                  </span>
                )}
                <span className="story-card__label">{card.label}</span>
              </header>
              <p className="story-card__value">{card.value}</p>
              {card.headline && (
                <p className="story-card__headline">{card.headline}</p>
              )}
              {card.caption && (
                <p className="story-card__caption">{card.caption}</p>
              )}
              {card.footer && (
                <p className="story-card__footer">{card.footer}</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
