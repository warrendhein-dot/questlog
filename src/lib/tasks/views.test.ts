import { describe, expect, it } from "vitest";
import type { Task } from "./schema";
import { isValidTimeZone, parseView, selectToday, selectWeek, todayIn, weekBounds } from "./views";

describe("parseView", () => {
  it.each(["today", "week", "all"])("accepts %s", (view) => {
    expect(parseView(view)).toBe(view);
  });

  it.each([undefined, null, "", "Today", "month", "<script>", ["week"], 42])(
    "falls back to today for %s",
    (value) => {
      expect(parseView(value)).toBe("today");
    },
  );
});

describe("isValidTimeZone", () => {
  it.each(["UTC", "Africa/Johannesburg", "America/Los_Angeles", "Pacific/Auckland"])(
    "accepts %s",
    (zone) => {
      expect(isValidTimeZone(zone)).toBe(true);
    },
  );

  it.each(["", "Mars/Olympus_Mons", "not a zone", "x".repeat(65), null, undefined, 5])(
    "rejects %s",
    (zone) => {
      expect(isValidTimeZone(zone)).toBe(false);
    },
  );
});

describe("todayIn", () => {
  // 23:30 UTC on 27 October is already the 28th in Johannesburg (UTC+2) and still the 27th in Los Angeles.
  const lateEvening = new Date("2026-10-27T23:30:00Z");

  it("gives the calendar date in the given time zone", () => {
    expect(todayIn("UTC", lateEvening)).toBe("2026-10-27");
    expect(todayIn("Africa/Johannesburg", lateEvening)).toBe("2026-10-28");
    expect(todayIn("America/Los_Angeles", lateEvening)).toBe("2026-10-27");
    expect(todayIn("Pacific/Auckland", lateEvening)).toBe("2026-10-28");
  });

  it("follows daylight saving: Los Angeles moves from UTC-7 to UTC-8 on 1 November 2026", () => {
    expect(todayIn("America/Los_Angeles", new Date("2026-11-01T07:30:00Z"))).toBe("2026-11-01");
    expect(todayIn("America/Los_Angeles", new Date("2026-11-01T08:30:00Z"))).toBe("2026-11-01");
    expect(todayIn("America/Los_Angeles", new Date("2026-11-02T07:59:00Z"))).toBe("2026-11-01");
    expect(todayIn("America/Los_Angeles", new Date("2026-11-02T08:01:00Z"))).toBe("2026-11-02");
  });

  it("rolls over the year and pads single digits", () => {
    expect(todayIn("UTC", new Date("2027-01-01T00:00:00Z"))).toBe("2027-01-01");
    expect(todayIn("UTC", new Date("2026-03-05T12:00:00Z"))).toBe("2026-03-05");
  });

  it("treats an unknown time zone as UTC instead of failing", () => {
    expect(todayIn("Mars/Olympus_Mons", lateEvening)).toBe("2026-10-27");
    expect(todayIn("", lateEvening)).toBe("2026-10-27");
  });
});

describe("weekBounds", () => {
  it.each([
    ["a Wednesday", "2026-10-28", "2026-10-26", "2026-11-01"],
    ["a Monday (the first day)", "2026-10-26", "2026-10-26", "2026-11-01"],
    ["a Sunday (the last day)", "2026-11-01", "2026-10-26", "2026-11-01"],
    ["a week that crosses into a new year", "2026-12-31", "2026-12-28", "2027-01-03"],
    ["a week that includes a leap day", "2028-02-29", "2028-02-28", "2028-03-05"],
    ["a week that starts in the previous month", "2026-03-01", "2026-02-23", "2026-03-01"],
  ])("%s", (_label, date, start, end) => {
    expect(weekBounds(date)).toEqual({ start, end });
  });
});

const base: Task = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  title: "Quest",
  notes: "",
  category: "work",
  priority: "normal",
  dueDate: null,
  completedAt: null,
  pinnedFor: null,
  recurrence: null,
};
const quest = (title: string, extra: Partial<Task> = {}): Task => ({ ...base, title, ...extra });
const titles = (list: Task[]) => list.map((t) => t.title);

// Wednesday 28 October 2026; the week runs Monday 26 October to Sunday 1 November.
const TODAY = "2026-10-28";

describe("selectToday", () => {
  it("shows overdue quests first, oldest due date first, then today's", () => {
    const result = selectToday(
      [
        quest("Due today", { dueDate: TODAY }),
        quest("Overdue recently", { dueDate: "2026-10-27" }),
        quest("Overdue long ago", { dueDate: "2026-09-01" }),
      ],
      TODAY,
    );
    expect(titles(result.overdue)).toEqual(["Overdue long ago", "Overdue recently"]);
    expect(titles(result.today)).toEqual(["Due today"]);
  });

  it("includes quests pinned to today, even with no due date or a later one", () => {
    const result = selectToday(
      [
        quest("Pinned, undated", { pinnedFor: TODAY }),
        quest("Pinned, due next month", { dueDate: "2026-11-30", pinnedFor: TODAY }),
        quest("Not pinned, undated"),
      ],
      TODAY,
    );
    expect(titles(result.today).sort()).toEqual(["Pinned, due next month", "Pinned, undated"]);
  });

  it("ignores a pin from another day", () => {
    const result = selectToday(
      [
        quest("Pinned yesterday", { pinnedFor: "2026-10-27" }),
        quest("Tomorrow's", { pinnedFor: "2026-10-29" }),
      ],
      TODAY,
    );
    expect(result).toEqual({ overdue: [], today: [] });
  });

  it("orders today's quests by priority, then title", () => {
    const result = selectToday(
      [
        quest("b normal", { dueDate: TODAY }),
        quest("a normal", { dueDate: TODAY }),
        quest("z high", { dueDate: TODAY, priority: "high" }),
        quest("a low", { dueDate: TODAY, priority: "low" }),
      ],
      TODAY,
    );
    expect(titles(result.today)).toEqual(["z high", "a normal", "b normal", "a low"]);
  });

  it("orders overdue quests of the same date by priority", () => {
    const result = selectToday(
      [
        quest("low", { dueDate: "2026-10-20", priority: "low" }),
        quest("high", { dueDate: "2026-10-20", priority: "high" }),
      ],
      TODAY,
    );
    expect(titles(result.overdue)).toEqual(["high", "low"]);
  });

  it("lists an overdue quest that is also pinned once, under overdue", () => {
    const result = selectToday([quest("Both", { dueDate: "2026-10-20", pinnedFor: TODAY })], TODAY);
    expect(titles(result.overdue)).toEqual(["Both"]);
    expect(result.today).toEqual([]);
  });

  it("leaves out future quests and completed quests", () => {
    const result = selectToday(
      [
        quest("Future", { dueDate: "2026-10-29" }),
        quest("Done today", { dueDate: TODAY, completedAt: "2026-10-28T08:00:00Z" }),
        quest("Done and overdue", { dueDate: "2026-10-01", completedAt: "2026-10-02T08:00:00Z" }),
        quest("Done and pinned", { pinnedFor: TODAY, completedAt: "2026-10-28T08:00:00Z" }),
      ],
      TODAY,
    );
    expect(result).toEqual({ overdue: [], today: [] });
  });

  it("copes with no quests", () => {
    expect(selectToday([], TODAY)).toEqual({ overdue: [], today: [] });
  });
});

describe("selectWeek", () => {
  it("shows overdue quests first, then quests due from today to Sunday, soonest first", () => {
    const result = selectWeek(
      [
        quest("Sunday", { dueDate: "2026-11-01" }),
        quest("Today", { dueDate: TODAY }),
        quest("Friday", { dueDate: "2026-10-30" }),
        quest("Overdue", { dueDate: "2026-10-26" }),
      ],
      TODAY,
    );
    expect(titles(result.overdue)).toEqual(["Overdue"]);
    expect(titles(result.thisWeek)).toEqual(["Today", "Friday", "Sunday"]);
  });

  it("stops at Sunday: the next Monday and later are not this week", () => {
    const result = selectWeek(
      [
        quest("Next Monday", { dueDate: "2026-11-02" }),
        quest("Much later", { dueDate: "2027-05-01" }),
      ],
      TODAY,
    );
    expect(result).toEqual({ overdue: [], thisWeek: [] });
  });

  it("leaves out undated quests, since nothing places them in a week", () => {
    expect(selectWeek([quest("Undated")], TODAY)).toEqual({ overdue: [], thisWeek: [] });
  });

  it("orders quests due on the same day by priority, then title", () => {
    const result = selectWeek(
      [
        quest("b", { dueDate: "2026-10-30" }),
        quest("a", { dueDate: "2026-10-30" }),
        quest("urgent", { dueDate: "2026-10-30", priority: "high" }),
      ],
      TODAY,
    );
    expect(titles(result.thisWeek)).toEqual(["urgent", "a", "b"]);
  });

  it("uses the week that contains today, even on a Sunday or a Monday", () => {
    const sunday = selectWeek(
      [quest("Same Sunday", { dueDate: "2026-11-01" }), quest("Monday", { dueDate: "2026-11-02" })],
      "2026-11-01",
    );
    expect(titles(sunday.thisWeek)).toEqual(["Same Sunday"]);
    const monday = selectWeek([quest("Sunday", { dueDate: "2026-11-01" })], "2026-10-26");
    expect(titles(monday.thisWeek)).toEqual(["Sunday"]);
  });

  it("leaves out completed quests", () => {
    const result = selectWeek(
      [
        quest("Done", { dueDate: "2026-10-30", completedAt: "2026-10-28T08:00:00Z" }),
        quest("Done and overdue", { dueDate: "2026-10-01", completedAt: "2026-10-02T08:00:00Z" }),
      ],
      TODAY,
    );
    expect(result).toEqual({ overdue: [], thisWeek: [] });
  });
});
