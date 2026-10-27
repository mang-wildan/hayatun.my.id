import {
  DIGITAL_STATUSES, ORDER_STATUSES, PHYSICAL_STATUSES, STATUS_LABELS, STATUS_TONES,
} from "@hayatun/shared";
import { describe, expect, it } from "vitest";
import { initialState, isComplete, transition, type OrderEvent, type OrderState } from "./state-machine.js";

// N33: setiap kejadian dicoba dari setiap keadaan. Hasil yang diharapkan ditulis tangan dari diagram SPEC bagian 3,
// bukan dihitung ulang, dan semua pasangan yang tidak tercantum harus ditolak.

const S = (status: OrderState["status"], digital: OrderState["digital"], physical: OrderState["physical"]): OrderState => ({ status, digital, physical });

const STATES = {
  menungguBayar: S("MENUNGGU_PEMBAYARAN", "MENUNGGU", "MENUNGGU"),
  menungguVerifikasi: S("MENUNGGU_VERIFIKASI", "MENUNGGU", "MENUNGGU"),
  lunasDigitalTerkirim: S("LUNAS", "TERKIRIM", "TIDAK_ADA"),
  lunasLisensiTertunda: S("LUNAS", "LISENSI_TERTUNDA", "TIDAK_ADA"),
  lunasDiproses: S("LUNAS", "TIDAK_ADA", "DIPROSES"),
  lunasDikirim: S("LUNAS", "TIDAK_ADA", "DIKIRIM"),
  lunasDiterima: S("LUNAS", "TIDAK_ADA", "DITERIMA"),
  lunasCampur: S("LUNAS", "TERKIRIM", "DIPROSES"),
  kedaluwarsa: S("KEDALUWARSA", "MENUNGGU", "MENUNGGU"),
  dibatalkanPembeli: S("DIBATALKAN", "MENUNGGU", "MENUNGGU"),
  dibatalkanAdmin: S("DIBATALKAN", "DICABUT", "DIPROSES"),
  dikembalikan: S("DIKEMBALIKAN", "DICABUT", "DIKIRIM"),
} satisfies Record<string, OrderState>;

const EVENTS = {
  unggahBukti: { type: "PROOF_UPLOADED" },
  buktiDitolak: { type: "PROOF_REJECTED" },
  buktiDiterima: { type: "PAYMENT_ACCEPTED" },
  buktiDiterimaLisensiKosong: { type: "PAYMENT_ACCEPTED", licensePending: true },
  gateway: { type: "GATEWAY_PAID" },
  gatewayLisensiKosong: { type: "GATEWAY_PAID", licensePending: true },
  lewat24Jam: { type: "EXPIRED" },
  batalPembeli: { type: "CANCELLED_BY_BUYER" },
  lisensiMenyusul: { type: "LICENSE_DELIVERED" },
  resiDiisi: { type: "SHIPPED" },
  diterimaPembeli: { type: "RECEIVED" },
  batalAdmin: { type: "CANCELLED_BY_ADMIN", refunded: false },
  dikembalikanAdmin: { type: "CANCELLED_BY_ADMIN", refunded: true },
} satisfies Record<string, OrderEvent>;

type StateName = keyof typeof STATES;
type EventName = keyof typeof EVENTS;

const ALLOWED: Record<StateName, Partial<Record<EventName, OrderState>>> = {
  menungguBayar: {
    unggahBukti: S("MENUNGGU_VERIFIKASI", "MENUNGGU", "MENUNGGU"),
    lewat24Jam: S("KEDALUWARSA", "MENUNGGU", "MENUNGGU"),
    batalPembeli: S("DIBATALKAN", "MENUNGGU", "MENUNGGU"),
    gateway: S("LUNAS", "TERKIRIM", "DIPROSES"), // tahap 2 (N36)
    gatewayLisensiKosong: S("LUNAS", "LISENSI_TERTUNDA", "DIPROSES"),
  },
  menungguVerifikasi: {
    buktiDitolak: S("MENUNGGU_PEMBAYARAN", "MENUNGGU", "MENUNGGU"),
    buktiDiterima: S("LUNAS", "TERKIRIM", "DIPROSES"),
    buktiDiterimaLisensiKosong: S("LUNAS", "LISENSI_TERTUNDA", "DIPROSES"), // F7.7
  },
  lunasDigitalTerkirim: {
    batalAdmin: S("DIBATALKAN", "DICABUT", "TIDAK_ADA"),
    dikembalikanAdmin: S("DIKEMBALIKAN", "DICABUT", "TIDAK_ADA"),
  },
  lunasLisensiTertunda: {
    lisensiMenyusul: S("LUNAS", "TERKIRIM", "TIDAK_ADA"),
    batalAdmin: S("DIBATALKAN", "DICABUT", "TIDAK_ADA"),
    dikembalikanAdmin: S("DIKEMBALIKAN", "DICABUT", "TIDAK_ADA"),
  },
  // status fisik dibiarkan saat dibatalkan admin: F10.3 memakainya untuk memutuskan stok kembali atau tidak
  lunasDiproses: {
    resiDiisi: S("LUNAS", "TIDAK_ADA", "DIKIRIM"),
    batalAdmin: S("DIBATALKAN", "TIDAK_ADA", "DIPROSES"),
    dikembalikanAdmin: S("DIKEMBALIKAN", "TIDAK_ADA", "DIPROSES"),
  },
  lunasDikirim: {
    diterimaPembeli: S("LUNAS", "TIDAK_ADA", "DITERIMA"),
    batalAdmin: S("DIBATALKAN", "TIDAK_ADA", "DIKIRIM"),
    dikembalikanAdmin: S("DIKEMBALIKAN", "TIDAK_ADA", "DIKIRIM"),
  },
  lunasDiterima: {
    batalAdmin: S("DIBATALKAN", "TIDAK_ADA", "DITERIMA"),
    dikembalikanAdmin: S("DIKEMBALIKAN", "TIDAK_ADA", "DITERIMA"),
  },
  lunasCampur: {
    resiDiisi: S("LUNAS", "TERKIRIM", "DIKIRIM"),
    batalAdmin: S("DIBATALKAN", "DICABUT", "DIPROSES"),
    dikembalikanAdmin: S("DIKEMBALIKAN", "DICABUT", "DIPROSES"),
  },
  kedaluwarsa: {}, // termasuk gateway yang terlambat (F14.6): ditolak, pemanggil menandainya untuk admin
  dibatalkanPembeli: {},
  dibatalkanAdmin: {},
  dikembalikan: {},
};

const REJECTED = { status: 409, code: "INVALID_TRANSITION", message: "Pesanan ini tidak bisa diubah ke status itu. Muat ulang halaman untuk melihat status terbarunya." };

describe("transition: setiap kejadian dari setiap keadaan (N33)", () => {
  for (const [stateName, state] of Object.entries(STATES) as [StateName, OrderState][]) {
    for (const [eventName, event] of Object.entries(EVENTS) as [EventName, OrderEvent][]) {
      const expected = ALLOWED[stateName][eventName];
      it(`${stateName} + ${eventName} → ${expected ? `${expected.status}/${expected.digital}/${expected.physical}` : "ditolak"}`, () => {
        const before = structuredClone(state);
        if (expected) expect(transition(state, event)).toEqual(expected);
        else expect(() => transition(state, event)).toThrow(expect.objectContaining(REJECTED));
        expect(state).toEqual(before); // tidak mengubah keadaan masukan
      });
    }
  }
});

describe("pesanan hanya digital atau hanya fisik", () => {
  it("lunas: bagian yang tidak ada tetap TIDAK_ADA", () => {
    const digital = transition(initialState({ hasDigital: true, hasPhysical: false }), EVENTS.unggahBukti);
    expect(transition(digital, EVENTS.buktiDiterima)).toEqual(S("LUNAS", "TERKIRIM", "TIDAK_ADA"));
    const physical = transition(initialState({ hasDigital: false, hasPhysical: true }), EVENTS.unggahBukti);
    expect(transition(physical, EVENTS.buktiDiterima)).toEqual(S("LUNAS", "TIDAK_ADA", "DIPROSES"));
    expect(transition(physical, EVENTS.buktiDiterimaLisensiKosong)).toEqual(S("LUNAS", "TIDAK_ADA", "DIPROSES")); // tanpa bagian digital, lisensi tidak berlaku
  });

  it("resi dan diterima ditolak bila tidak ada bagian fisik; lisensi menyusul ditolak bila tidak tertunda", () => {
    const digitalOnly = S("LUNAS", "TERKIRIM", "TIDAK_ADA");
    for (const e of [EVENTS.resiDiisi, EVENTS.diterimaPembeli, EVENTS.lisensiMenyusul]) expect(() => transition(digitalOnly, e)).toThrow(expect.objectContaining(REJECTED));
  });
});

describe("initialState", () => {
  it("selalu mulai di Menunggu Pembayaran; bagian yang ada menunggu, yang tidak ada TIDAK_ADA", () => {
    expect(initialState({ hasDigital: true, hasPhysical: true })).toEqual(S("MENUNGGU_PEMBAYARAN", "MENUNGGU", "MENUNGGU"));
    expect(initialState({ hasDigital: true, hasPhysical: false })).toEqual(S("MENUNGGU_PEMBAYARAN", "MENUNGGU", "TIDAK_ADA"));
    expect(initialState({ hasDigital: false, hasPhysical: true })).toEqual(S("MENUNGGU_PEMBAYARAN", "TIDAK_ADA", "MENUNGGU"));
  });

  it("pesanan tanpa produk ditolak", () => {
    expect(() => initialState({ hasDigital: false, hasPhysical: false })).toThrow();
  });
});

describe("isComplete: pesanan selesai ketika semua bagiannya selesai", () => {
  it.each([
    ["lunasDigitalTerkirim", true],
    ["lunasDiterima", true],
    ["lunasLisensiTertunda", false],
    ["lunasDiproses", false],
    ["lunasDikirim", false],
    ["lunasCampur", false],
    ["menungguBayar", false],
    ["menungguVerifikasi", false],
    ["kedaluwarsa", false],
    ["dibatalkanAdmin", false],
    ["dikembalikan", false],
  ] as [StateName, boolean][])("%s → %s", (name, done) => expect(isComplete(STATES[name])).toBe(done));

  it("campuran selesai hanya bila digital terkirim dan fisik diterima", () => {
    expect(isComplete(S("LUNAS", "TERKIRIM", "DITERIMA"))).toBe(true);
    expect(isComplete(S("LUNAS", "LISENSI_TERTUNDA", "DITERIMA"))).toBe(false);
  });
});

describe("gateway tahap 2 tidak mengubah diagram tahap 1 (N36)", () => {
  // perpindahan status utama yang benar-benar dihasilkan implementasi, dari semua keadaan dan kejadian di atas
  const edges = (events: OrderEvent[]) => {
    const out = new Set<string>();
    for (const s of Object.values(STATES)) for (const e of events) {
      try { out.add(`${s.status}->${transition(s, e).status}`); } catch { /* ditolak */ }
    }
    return out;
  };
  const tahap1 = Object.values(EVENTS).filter((e) => e.type !== "GATEWAY_PAID");

  it("tanpa gateway: persis jalur di diagram SPEC bagian 3", () => {
    expect([...edges(tahap1)].sort()).toEqual([
      "LUNAS->DIBATALKAN",
      "LUNAS->DIKEMBALIKAN",
      "LUNAS->LUNAS", // bagian digital dan fisik bergerak, status utama tetap Lunas
      "MENUNGGU_PEMBAYARAN->DIBATALKAN",
      "MENUNGGU_PEMBAYARAN->KEDALUWARSA",
      "MENUNGGU_PEMBAYARAN->MENUNGGU_VERIFIKASI",
      "MENUNGGU_VERIFIKASI->LUNAS",
      "MENUNGGU_VERIFIKASI->MENUNGGU_PEMBAYARAN",
    ]);
  });

  it("gateway hanya menambah Menunggu Pembayaran → Lunas, dengan hasil yang sama seperti bukti diterima", () => {
    const withGateway = edges(Object.values(EVENTS));
    expect([...withGateway].filter((e) => !edges(tahap1).has(e))).toEqual(["MENUNGGU_PEMBAYARAN->LUNAS"]);
    expect(transition(STATES.menungguBayar, EVENTS.gateway)).toEqual(transition(STATES.menungguVerifikasi, EVENTS.buktiDiterima));
  });
});

describe("enum dan label bersama (ARCHITECTURE §4, DESIGN warna status)", () => {
  it("nilai persis seperti ARCHITECTURE", () => {
    expect(ORDER_STATUSES).toEqual(["MENUNGGU_PEMBAYARAN", "MENUNGGU_VERIFIKASI", "LUNAS", "KEDALUWARSA", "DIBATALKAN", "DIKEMBALIKAN"]);
    expect(DIGITAL_STATUSES).toEqual(["TIDAK_ADA", "MENUNGGU", "TERKIRIM", "LISENSI_TERTUNDA", "DICABUT"]);
    expect(PHYSICAL_STATUSES).toEqual(["TIDAK_ADA", "MENUNGGU", "DIPROSES", "DIKIRIM", "DITERIMA"]);
  });

  it("setiap nilai punya label dan warna", () => {
    for (const [kind, values] of [["order", ORDER_STATUSES], ["digital", DIGITAL_STATUSES], ["physical", PHYSICAL_STATUSES]] as const) {
      for (const v of values) {
        expect((STATUS_LABELS[kind] as Record<string, string>)[v], `${kind}.${v}`).toMatch(/\S/);
        expect(["ok", "wait", "danger", "neutral"], `${kind}.${v}`).toContain((STATUS_TONES[kind] as Record<string, string>)[v]);
      }
    }
  });

  it("label dan warna mengikuti DESIGN", () => {
    expect(STATUS_LABELS.order).toMatchObject({ MENUNGGU_PEMBAYARAN: "Menunggu pembayaran", MENUNGGU_VERIFIKASI: "Menunggu verifikasi", LUNAS: "Lunas", KEDALUWARSA: "Kedaluwarsa", DIBATALKAN: "Dibatalkan", DIKEMBALIKAN: "Dikembalikan" });
    expect(STATUS_LABELS.digital).toMatchObject({ TERKIRIM: "Terkirim", LISENSI_TERTUNDA: "Lisensi tertunda" });
    expect(STATUS_LABELS.physical).toMatchObject({ DIPROSES: "Diproses", DIKIRIM: "Dikirim", DITERIMA: "Diterima" });
    expect(STATUS_TONES.order).toMatchObject({ LUNAS: "ok", MENUNGGU_VERIFIKASI: "wait", MENUNGGU_PEMBAYARAN: "neutral", KEDALUWARSA: "neutral", DIBATALKAN: "neutral" });
    expect(STATUS_TONES.digital).toMatchObject({ TERKIRIM: "ok", LISENSI_TERTUNDA: "wait" });
    expect(STATUS_TONES.physical).toMatchObject({ DIPROSES: "neutral", DIKIRIM: "neutral", DITERIMA: "ok" });
  });
});
