export const counterReactAppSource = `function counter_app(): ReactApp {
  l\`a button with text '0' that increments each time it's clicked\`
}`;

export const deterministicCounterReactAppSource = `function counter_app(): ReactApp {
  const [count, setCount] = React.useState(0);

  return React.createElement(
    "main",
    {
      style: {
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        margin: 0,
        background: "#f8fafc",
        color: "#111827",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      },
    },
    React.createElement(
      radix.Button,
      {
        size: "4",
        variant: "solid",
        onClick: () => setCount((value: number) => value + 1),
        "data-testid": "counter-button",
        "aria-label": "Increment counter",
      },
      String(count),
    ),
  );
}`;
