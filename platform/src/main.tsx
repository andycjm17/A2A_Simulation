import { createRoot } from "react-dom/client";
import App from "./App";
import OAuthConsent from "./OAuthConsent";
import "./style.css";
import "./club-theme.css";
createRoot(document.getElementById("root")!).render(
  location.pathname === "/oauth/authorize" ? <OAuthConsent /> : <App />,
);
