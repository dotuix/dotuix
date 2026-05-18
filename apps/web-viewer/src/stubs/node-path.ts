// Stub — minimal path utilities for the browser.
export const join = (...parts: string[]): string =>
  parts.filter(Boolean).join("/").replace(/\/+/g, "/");

export const dirname = (p: string): string =>
  p.includes("/") ? p.split("/").slice(0, -1).join("/") || "/" : ".";

export const basename = (p: string, ext?: string): string => {
  let base = p.split("/").pop() ?? p;
  if (ext && base.endsWith(ext)) base = base.slice(0, -ext.length);
  return base;
};

export const extname = (p: string): string => {
  const base = p.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
};

export const resolve = (...parts: string[]): string => join(...parts);
export const relative = (_from: string, to: string): string => to;
export const sep = "/";

export default { join, dirname, basename, extname, resolve, relative, sep };
