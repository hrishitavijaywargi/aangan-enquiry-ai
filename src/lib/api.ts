import { NextResponse } from "next/server";
import { ready } from "./ready";

/** Wrap a route handler: ensure DB is ready, convert thrown errors into JSON 400s. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<unknown> | unknown) {
  return async (...args: A) => {
    try {
      await ready();
      const out = await fn(...args);
      return out instanceof Response ? out : NextResponse.json(out);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  };
}
