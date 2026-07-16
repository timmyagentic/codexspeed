import { SiteFooter } from "../components/SiteFooter.js";
import { SiteHeader } from "../components/SiteHeader.js";
import { LatestPage } from "./routes/LatestPage.js";
import { LocalRunPage } from "./routes/LocalRunPage.js";
import { MethodologyPage } from "./routes/MethodologyPage.js";
import { NotFoundPage } from "./routes/NotFoundPage.js";
import { RunDetailPage } from "./routes/RunDetailPage.js";
import { RunsPage } from "./routes/RunsPage.js";

function route(pathname: string) {
  const normalized =
    pathname.length > 1 ? pathname.replace(/\/$/u, "") : pathname;
  if (normalized === "/") {
    return <LatestPage />;
  }
  if (normalized === "/runs") {
    return <RunsPage />;
  }
  if (normalized === "/local") {
    return <LocalRunPage />;
  }
  if (normalized === "/methodology") {
    return <MethodologyPage />;
  }
  const match = /^\/runs\/([0-9a-f-]+)$/iu.exec(normalized);
  if (match?.[1] !== undefined) {
    return <RunDetailPage runId={match[1]} />;
  }
  return <NotFoundPage />;
}

export function App() {
  const pathname = window.location.pathname;
  return (
    <div className="site-shell">
      <SiteHeader activePath={pathname} />
      <main id="main-content">{route(pathname)}</main>
      <SiteFooter />
    </div>
  );
}
