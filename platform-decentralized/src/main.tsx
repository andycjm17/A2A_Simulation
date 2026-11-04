import { createRoot } from "react-dom/client";
import App from "./App";
import Lab from './Lab';
import "./style.css";
import "./club-theme.css";
createRoot(document.getElementById("root")!).render(['/lab','/lab/'].includes(location.pathname)?<Lab />:<App />);
