import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./app/styles.css";

createRoot(document.getElementById("root")!).render(<App />);
if ("serviceWorker" in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
}
