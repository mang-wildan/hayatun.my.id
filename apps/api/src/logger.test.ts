import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";

const capture = () => {
  let out = "";
  return { stream: new Writable({ write(c, _e, cb) { out += c; cb(); } }), text: () => out };
};

describe("createLogger", () => {
  it("menyamarkan data sensitif (N30)", () => {
    const sink = capture();
    const log = createLogger({ logLevel: "info" } as never, sink.stream);
    log.info(
      {
        req: { headers: { cookie: "hayatun_sid=RAHASIA-COOKIE", authorization: "Bearer RAHASIA-AUTH" } },
        user: { email: "budi@mail.com", phone: "0812RAHASIA", address: "Jl. RAHASIA 1" },
        password: "RAHASIA-PW",
        token: "RAHASIA-TOKEN",
      },
      "hai",
    );
    expect(sink.text()).toContain("hai");
    expect(sink.text()).not.toMatch(/RAHASIA|budi@mail\.com/);
  });
});
