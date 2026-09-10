export default function Hero() {
  return (
    <section className="hero-masthead" aria-labelledby="masthead-title">
      <div className="hero-masthead-diag" aria-hidden="true" />

      <div className="hero-masthead-inner">
        <div className="hero-masthead-headline-row">
          <div className="hero-masthead-headline-col">
            <h1 id="masthead-title" className="hero-masthead-h1 pc-display">
              Give agents money.
              <br />
              Keep the
              <span className="hero-masthead-highlight">
                <span className="hero-masthead-highlight-text">authority</span>
                <span className="hero-masthead-highlight-mark" aria-hidden="true" />
              </span>
              .
            </h1>
          </div>
        </div>
      </div>
    </section>
  );
}
