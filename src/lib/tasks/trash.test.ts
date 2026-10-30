import { describe, expect, it } from "vitest";
import { deletedOn, purgeDate, TRASH_DAYS } from "./trash";

describe("deletedOn", () => {
  it("is the calendar date of the timestamp in the user's time zone", () => {
    expect(deletedOn("2026-10-30T03:57:46Z", "UTC")).toBe("2026-10-30");
    // 23:30 UTC on the 30th is already 01:30 on the 31st in Johannesburg (UTC+2).
    expect(deletedOn("2026-10-30T23:30:00Z", "Africa/Johannesburg")).toBe("2026-10-31");
    // ... and still the 30th in New York (UTC-4 in October).
    expect(deletedOn("2026-10-30T23:30:00Z", "America/New_York")).toBe("2026-10-30");
  });

  it("reads a timestamp the way the API returns it, with microseconds and an offset", () => {
    expect(deletedOn("2026-10-30T03:57:46.123456+00:00", "UTC")).toBe("2026-10-30");
  });
});

describe("purgeDate", () => {
  it("is 30 days after the day the quest was deleted", () => {
    expect(TRASH_DAYS).toBe(30);
    expect(purgeDate("2026-10-30T03:57:46Z", "UTC")).toBe("2026-11-29");
  });

  it("counts from the user's own day, not the UTC day", () => {
    expect(purgeDate("2026-10-30T23:30:00Z", "Africa/Johannesburg")).toBe("2026-11-30");
    expect(purgeDate("2026-10-30T23:30:00Z", "UTC")).toBe("2026-11-29");
  });

  it("crosses a year end", () => {
    expect(purgeDate("2026-12-15T10:00:00Z", "UTC")).toBe("2027-01-14");
  });

  it("copes with the leap day", () => {
    expect(purgeDate("2028-02-01T00:00:00Z", "UTC")).toBe("2028-03-02");
    expect(purgeDate("2027-02-01T00:00:00Z", "UTC")).toBe("2027-03-03");
  });
});
