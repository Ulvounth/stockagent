"use client";

import { useEffect, useRef, useState } from "react";

export function OilSidebar() {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const host = container.current;
    if (!host) return;

    // The embed reads its configuration from its own script element. Give
    // each effect a separate mount so Strict Mode cleanup cannot duplicate it.
    const mount = document.createElement("div");
    mount.className = "tradingview-widget-container h-full w-full";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget h-full w-full";
    mount.appendChild(widget);
    host.appendChild(mount);

    const events = new AbortController();
    const timeout = window.setTimeout(() => setStatus("error"), 20_000);
    const observer = new MutationObserver(() => {
      const frame = mount.querySelector("iframe");
      if (!frame) return;
      frame.title = "Oljepris: Brent og WTI med kursutvikling";
      frame.addEventListener("load", () => {
        window.clearTimeout(timeout);
        setStatus("ready");
      }, { once: true, signal: events.signal });
      observer.disconnect();
    });
    observer.observe(mount, { childList: true, subtree: true });

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js";
    script.async = true;
    script.addEventListener("error", () => {
      window.clearTimeout(timeout);
      setStatus("error");
    }, { signal: events.signal });
    script.textContent = JSON.stringify({
      symbols: [["Brent", "TVC:UKOIL|1D"], ["WTI", "TVC:USOIL|1D"]],
      chartOnly: false,
      width: "100%",
      height: "100%",
      locale: "no",
      colorTheme: "light",
      autosize: true,
      showVolume: false,
      showMA: false,
      hideDateRanges: false,
      hideMarketStatus: false,
      hideSymbolLogo: true,
      scalePosition: "right",
      scaleMode: "Normal",
      fontFamily: "Arial, sans-serif",
      fontSize: "12",
      chartType: "area",
      lineWidth: 2,
      lineColor: "#0f766e",
      topColor: "rgba(13, 148, 136, 0.20)",
      bottomColor: "rgba(13, 148, 136, 0.01)",
      changeMode: "price-and-percent",
      dateRanges: ["1d|5", "1m|60", "3m|1D", "12m|1D"],
      dateFormat: "dd.MM.yyyy",
      timeHoursFormat: "24-hours",
    });
    // An async script keeps loading after its node is detached, so a Strict
    // Mode dry run would inject the widget into the mount we just removed and
    // TradingView would log about the detached iframe's missing contentWindow.
    // Deferring past cleanup means the discarded pass never injects anything.
    queueMicrotask(() => {
      if (events.signal.aborted) return;
      mount.appendChild(script);
    });

    return () => {
      window.clearTimeout(timeout);
      events.abort();
      observer.disconnect();
      mount.remove();
    };
  }, []);

  return (
    <aside aria-labelledby="oil-heading" className="min-w-0 px-4 pb-8 sm:px-8 xl:py-12 xl:pl-0">
      <section className="panel p-5 xl:sticky xl:top-6">
        <p className="eyebrow">RÅVARER</p>
        <h2 id="oil-heading" className="mt-2 text-xl font-semibold">Oljeprisen</h2>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          Brent og WTI · USD per fat
        </p>
        <div className="relative mt-5 h-[360px]">
          <div ref={container} className="h-full w-full" />
          {status !== "ready" && (
            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500" role="status">
              {status === "loading" ? "Laster oljeprisen …" : "Grafen kunne ikke lastes. Du kan åpne prisene hos TradingView nedenfor."}
            </div>
          )}
        </div>
        <div className="tradingview-widget-copyright mt-3 text-xs">
          <a href="https://www.tradingview.com/symbols/TVC-UKOIL/" target="_blank" rel="noopener noreferrer nofollow" className="text-teal-700 hover:underline">Brent</a>
          {" og "}
          <a href="https://www.tradingview.com/symbols/TVC-USOIL/" target="_blank" rel="noopener noreferrer nofollow" className="text-teal-700 hover:underline">WTI</a>
          {" by TradingView"}
        </div>
        <p className="mt-4 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">
          Oppdateres automatisk mens markedet er åpent. Indikative CFD-priser;
          data kan være forsinket. Grafen følger markedet nå, også når du leser
          en eldre nyhetsrapport.
        </p>
        <noscript><p className="mt-3 text-sm text-slate-500">Slå på JavaScript for å se grafen, eller bruk lenkene over.</p></noscript>
      </section>
    </aside>
  );
}
