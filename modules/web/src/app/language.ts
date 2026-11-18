import { useSyncExternalStore } from "react";
import { messages } from "./messages";

export const languages = [
  { id: "zh-CN", name: "简体中文" },
  { id: "ja", name: "日本語" },
  { id: "en", name: "English" },
] as const;

export type Language = (typeof languages)[number]["id"];
const storageKey = "aster-language";
const listeners = new Set<() => void>();

function readLanguage(): Language {
  try {
    const saved = globalThis.localStorage?.getItem(storageKey);
    const language = languages.find(({ id }) => id === saved);
    if (language) return language.id;
  } catch {}
  return "zh-CN";
}

let language = readLanguage();

function applyLanguage(next: Language) {
  language = next;
  if (typeof document !== "undefined") document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  applyLanguage(language);
  window.addEventListener("storage", (event) => {
    if (event.key === storageKey || event.key === null)
      applyLanguage(readLanguage());
  });
}

export function setLanguage(next: Language) {
  try {
    globalThis.localStorage?.setItem(storageKey, next);
  } catch {}
  applyLanguage(next);
}

export function getLanguage() {
  return language;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function translate(
  locale: Language,
  source: string,
  ...values: unknown[]
): string {
  const entry = messages[source];
  const label = locale === "zh-CN" ? source : (entry?.[locale] ?? source);
  return values.length
    ? label.replace(/\{(\d+)\}/g, (match, index) =>
        index in values ? String(values[index]) : match,
      )
    : label;
}

function t(source: string, ...values: unknown[]) {
  return translate(language, source, ...values);
}

export const translateUI = t;

export function useI18n() {
  const locale = useSyncExternalStore(
    subscribe,
    getLanguage,
    () => "zh-CN" as Language,
  );
  return { locale, t };
}
