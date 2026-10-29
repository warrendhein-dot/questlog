import { describe, expect, it } from "vitest";
import {
  describeRecurrence,
  nextOccurrence,
  parseRecurrence,
  recurrenceToFormValues,
  type Recurrence,
} from "./recurrence";
import { addDays } from "./views";

const daily = (interval = 1): Recurrence => ({ frequency: "daily", interval, weekdays: [] });
const weekly = (interval = 1, weekdays: number[] = []): Recurrence => ({
  frequency: "weekly",
  interval,
  weekdays,
});
const monthly = (interval = 1): Recurrence => ({ frequency: "monthly", interval, weekdays: [] });

describe("nextOccurrence: daily", () => {
  it("is the next day for an ordinary daily quest", () => {
    expect(nextOccurrence(daily(), "2026-10-28", "2026-10-28")).toBe("2026-10-29");
  });

  it("steps by N days from the anchor", () => {
    expect(nextOccurrence(daily(3), "2026-10-28", "2026-10-28")).toBe("2026-10-31");
    expect(nextOccurrence(daily(3), "2026-10-28", "2026-10-31")).toBe("2026-11-03");
  });

  it("skips ahead, without piling up copies, when completed late", () => {
    // Due 28 Oct, finished on 5 Nov: the next one is 6 Nov, not 29 Oct.
    expect(nextOccurrence(daily(), "2026-10-28", "2026-11-05")).toBe("2026-11-06");
    // Every 3 days from 28 Oct falls on 31 Oct, 3 Nov, 6 Nov ...: after 5 Nov the next is 6 Nov.
    expect(nextOccurrence(daily(3), "2026-10-28", "2026-11-05")).toBe("2026-11-06");
  });

  it("crosses month and year ends", () => {
    expect(nextOccurrence(daily(), "2026-12-31", "2026-12-31")).toBe("2027-01-01");
    expect(nextOccurrence(daily(), "2028-02-28", "2028-02-28")).toBe("2028-02-29");
    expect(nextOccurrence(daily(), "2028-02-29", "2028-02-29")).toBe("2028-03-01");
  });
});

describe("nextOccurrence: weekly, same weekday", () => {
  it("is a week later", () => {
    expect(nextOccurrence(weekly(), "2026-10-28", "2026-10-28")).toBe("2026-11-04");
  });

  it("steps by N weeks", () => {
    expect(nextOccurrence(weekly(2), "2026-10-28", "2026-10-28")).toBe("2026-11-11");
  });

  it("when completed late, picks the next scheduled day after today, not the next in sequence", () => {
    // Mondays: due Mon 26 Oct, finished Wed 4 Nov: the next Monday is 9 Nov (not 2 Nov, already past).
    expect(nextOccurrence(weekly(), "2026-10-26", "2026-11-04")).toBe("2026-11-09");
    // Every other Monday from 26 Oct: 9 Nov, 23 Nov ... After Wed 4 Nov the next is 9 Nov.
    expect(nextOccurrence(weekly(2), "2026-10-26", "2026-11-04")).toBe("2026-11-09");
    // After 10 Nov it is 23 Nov.
    expect(nextOccurrence(weekly(2), "2026-10-26", "2026-11-10")).toBe("2026-11-23");
  });

  it("when completed early, keeps the schedule", () => {
    // Due Fri 30 Oct but ticked off on Wed 28 Oct (the caller passes the later of the two dates).
    expect(nextOccurrence(weekly(), "2026-10-30", "2026-10-30")).toBe("2026-11-06");
  });
});

describe("nextOccurrence: weekly on chosen days", () => {
  const MON_THU = [1, 4];

  it("moves to the next chosen day in the same week", () => {
    // Mon 26 Oct -> Thu 29 Oct
    expect(nextOccurrence(weekly(1, MON_THU), "2026-10-26", "2026-10-26")).toBe("2026-10-29");
  });

  it("wraps to the next week after the last chosen day", () => {
    // Thu 29 Oct -> Mon 2 Nov
    expect(nextOccurrence(weekly(1, MON_THU), "2026-10-26", "2026-10-29")).toBe("2026-11-02");
  });

  it("skips whole weeks for 'every other week'", () => {
    // Every 2nd week, Mon and Thu, starting Mon 26 Oct: 26, 29 Oct, then 9, 12 Nov.
    expect(nextOccurrence(weekly(2, MON_THU), "2026-10-26", "2026-10-29")).toBe("2026-11-09");
    expect(nextOccurrence(weekly(2, MON_THU), "2026-10-26", "2026-11-09")).toBe("2026-11-12");
  });

  it("starts the first week from the anchor, even when the anchor is mid-week", () => {
    // Anchor Wed 28 Oct, on Mon and Thu: the first date after the anchor is Thu 29 Oct.
    expect(nextOccurrence(weekly(1, MON_THU), "2026-10-28", "2026-10-28")).toBe("2026-10-29");
  });

  it("handles Sunday as the last day of the week", () => {
    // Sunday 1 Nov, rule on Sundays only -> Sunday 8 Nov
    expect(nextOccurrence(weekly(1, [7]), "2026-11-01", "2026-11-01")).toBe("2026-11-08");
    // Rule Sun and Mon, anchor Sun 1 Nov: Mon 2 Nov is the same ISO week? No: Monday starts a new week.
    expect(nextOccurrence(weekly(1, [1, 7]), "2026-11-01", "2026-11-01")).toBe("2026-11-02");
  });
});

describe("nextOccurrence: monthly", () => {
  it("is the same day next month", () => {
    expect(nextOccurrence(monthly(), "2026-10-15", "2026-10-15")).toBe("2026-11-15");
  });

  it("steps by N months and rolls over the year", () => {
    expect(nextOccurrence(monthly(3), "2026-10-15", "2026-10-15")).toBe("2027-01-15");
    expect(nextOccurrence(monthly(), "2026-12-15", "2026-12-15")).toBe("2027-01-15");
  });

  it("uses the last day of a month that is too short", () => {
    expect(nextOccurrence(monthly(), "2026-01-31", "2026-01-31")).toBe("2026-02-28");
    expect(nextOccurrence(monthly(), "2028-01-31", "2028-01-31")).toBe("2028-02-29"); // leap year
    expect(nextOccurrence(monthly(), "2026-03-31", "2026-03-31")).toBe("2026-04-30");
  });

  it("does not drift: the anchor's own day returns after a short month", () => {
    // The series is anchored on the 31st, so after February's 28th it is back to March 31st.
    expect(nextOccurrence(monthly(), "2026-01-31", "2026-02-28")).toBe("2026-03-31");
  });

  it("skips ahead when completed late", () => {
    // Due 15 Oct, finished on 20 Dec: next is 15 Jan.
    expect(nextOccurrence(monthly(), "2026-10-15", "2026-12-20")).toBe("2027-01-15");
    // Quarterly from 15 Oct: 15 Jan, 15 Apr ... After 20 Dec the next is 15 Jan.
    expect(nextOccurrence(monthly(3), "2026-10-15", "2026-12-20")).toBe("2027-01-15");
  });

  it("works for February 29th anchors", () => {
    expect(nextOccurrence(monthly(12), "2028-02-29", "2028-02-29")).toBe("2029-02-28");
    expect(nextOccurrence(monthly(48), "2028-02-29", "2028-02-29")).toBe("2032-02-29");
  });
});

describe("nextOccurrence: when `after` is before the anchor", () => {
  // Not what the app does (it always passes a date on or after the anchor), but the function should
  // still be right: the anchor is itself on the schedule, so it is the first date after `after`.
  it.each([
    ["daily", daily(3)],
    ["weekly", weekly(2)],
    ["weekly on chosen days", weekly(1, [1, 4])],
    ["monthly", monthly(2)],
  ])("returns the anchor itself for a %s rule", (_label, rule) => {
    const anchor = rule.weekdays.length > 0 ? "2026-10-26" : "2026-10-28"; // a Monday for the weekday rule
    expect(nextOccurrence(rule, anchor, "2026-09-01")).toBe(anchor);
    expect(nextOccurrence(rule, anchor, addDays(anchor, -1))).toBe(anchor);
  });
});

describe("nextOccurrence: the end of the calendar", () => {
  it("returns null when the next date would be past 2100, so the series ends", () => {
    expect(nextOccurrence(daily(), "2100-12-31", "2100-12-31")).toBeNull();
    expect(nextOccurrence(monthly(), "2100-12-15", "2100-12-15")).toBeNull();
  });

  it("still returns 31 December 2100 itself", () => {
    expect(nextOccurrence(daily(), "2100-12-30", "2100-12-30")).toBe("2100-12-31");
  });
});

// ---------------------------------------------------------------------------------------------
// An independent check. `isOnSchedule` states what the rule means, date by date, without searching;
// `nextOccurrence` finds dates by a different method. They must agree everywhere we look.
// ---------------------------------------------------------------------------------------------

function parts(date: string) {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return { y, m, d };
}
const dayNumber = (date: string) => {
  const { y, m, d } = parts(date);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};
const weekday = (date: string) => ((dayNumber(date) + 3) % 7) + 1; // 1 January 1970 was a Thursday
const weekNumber = (date: string) => Math.floor((dayNumber(date) + 3) / 7); // Monday-based weeks

function isOnSchedule(rule: Recurrence, anchor: string, date: string): boolean {
  if (date < anchor) return false;
  const diff = dayNumber(date) - dayNumber(anchor);
  if (rule.frequency === "daily") return diff % rule.interval === 0;
  if (rule.frequency === "weekly") {
    if (rule.weekdays.length === 0) return diff % (7 * rule.interval) === 0;
    return (
      rule.weekdays.includes(weekday(date)) &&
      (weekNumber(date) - weekNumber(anchor)) % rule.interval === 0
    );
  }
  const a = parts(anchor);
  const t = parts(date);
  const months = (t.y - a.y) * 12 + (t.m - a.m);
  const lastDay = new Date(Date.UTC(t.y, t.m, 0)).getUTCDate();
  return months % rule.interval === 0 && t.d === Math.min(a.d, lastDay);
}

describe("nextOccurrence agrees with a day-by-day reading of the rules", () => {
  const rules: Recurrence[] = [
    daily(1),
    daily(2),
    daily(7),
    daily(30),
    weekly(1),
    weekly(2),
    weekly(3),
    weekly(1, [1]),
    weekly(1, [2, 5]),
    weekly(2, [1, 4]),
    weekly(3, [3, 6, 7]),
    weekly(1, [1, 2, 3, 4, 5, 6, 7]),
    monthly(1),
    monthly(2),
    monthly(5),
    monthly(12),
  ];
  // Anchors chosen to hit month ends, short months, a leap day, year ends and every weekday.
  const anchors = [
    "2026-10-28",
    "2026-01-31",
    "2026-03-31",
    "2028-02-29",
    "2026-12-31",
    "2026-11-01",
    "2026-10-26",
    "2027-05-30",
  ];

  it("returns exactly the first scheduled date after `after`", () => {
    let checked = 0;
    for (const rule of rules) {
      for (const anchor of anchors) {
        for (let offset = 0; offset <= 400; offset += 7) {
          const after = addDays(anchor, offset);
          // Reference answer: walk forward one day at a time.
          let expected: string | null = null;
          for (let step = 1; step <= 800; step++) {
            const day = addDays(after, step);
            if (isOnSchedule(rule, anchor, day)) {
              expected = day;
              break;
            }
          }
          const label = `${JSON.stringify(rule)} anchor ${anchor} after ${after}`;
          expect(nextOccurrence(rule, anchor, after), label).toBe(expected);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });

  it("agrees when `after` falls on every day of a month, not just weekly samples", () => {
    for (const rule of [daily(3), weekly(2, [1, 4]), monthly(1)]) {
      for (let offset = 0; offset < 62; offset++) {
        const after = addDays("2026-01-31", offset);
        let expected: string | null = null;
        for (let step = 1; step <= 800 && expected === null; step++) {
          const day = addDays(after, step);
          if (isOnSchedule(rule, "2026-01-31", day)) expected = day;
        }
        expect(nextOccurrence(rule, "2026-01-31", after), `${JSON.stringify(rule)} ${after}`).toBe(
          expected,
        );
      }
    }
  });
});

describe("parseRecurrence", () => {
  const form = (repeat: string, interval = "1", weekdays: string[] = []) => ({
    repeat,
    interval,
    weekdays,
  });

  it.each(["none", "", " none "])("reads %j as 'does not repeat'", (repeat) => {
    expect(parseRecurrence(form(repeat, "banana", ["x"]))).toEqual({ success: true, value: null });
  });

  it("reads a simple rule", () => {
    expect(parseRecurrence(form("daily", "3"))).toEqual({
      success: true,
      value: { frequency: "daily", interval: 3, weekdays: [] },
    });
  });

  it("treats an empty 'every' box as 1", () => {
    expect(parseRecurrence(form("monthly", "  "))).toEqual({
      success: true,
      value: { frequency: "monthly", interval: 1, weekdays: [] },
    });
  });

  it("sorts and de-duplicates ticked weekdays for a weekly rule", () => {
    expect(parseRecurrence(form("weekly", "2", ["4", "1", "4"]))).toEqual({
      success: true,
      value: { frequency: "weekly", interval: 2, weekdays: [1, 4] },
    });
  });

  it("ignores ticked weekdays for daily and monthly rules", () => {
    expect(parseRecurrence(form("daily", "1", ["1", "9", "x"]))).toMatchObject({
      success: true,
      value: { weekdays: [] },
    });
    expect(parseRecurrence(form("monthly", "1", ["2"]))).toMatchObject({
      success: true,
      value: { weekdays: [] },
    });
  });

  it("accepts the limits of 'every'", () => {
    expect(parseRecurrence(form("daily", "1")).success).toBe(true);
    expect(parseRecurrence(form("daily", "365")).success).toBe(true);
  });

  it.each(["0", "366", "-1", "1.5", "abc", "1e2", "1000", "０"])(
    "rejects %j as the 'every' number",
    (interval) => {
      expect(parseRecurrence(form("daily", interval))).toEqual({
        success: false,
        errors: { interval: "Use a whole number from 1 to 365." },
      });
    },
  );

  it("rejects a repeat that is not in the list", () => {
    expect(parseRecurrence(form("hourly"))).toEqual({
      success: false,
      errors: { repeat: "Pick how often the quest repeats." },
    });
  });

  it.each([["0"], ["8"], ["monday"], [""]])("rejects the weekday %j", (day) => {
    expect(parseRecurrence(form("weekly", "1", [day]))).toEqual({
      success: false,
      errors: { weekdays: "Pick days of the week from the list." },
    });
  });

  it("reports a bad number and a bad weekday together", () => {
    expect(parseRecurrence(form("weekly", "0", ["9"]))).toEqual({
      success: false,
      errors: {
        interval: "Use a whole number from 1 to 365.",
        weekdays: "Pick days of the week from the list.",
      },
    });
  });
});

describe("recurrenceToFormValues", () => {
  it("fills the form from a saved rule, and from none", () => {
    expect(recurrenceToFormValues(weekly(2, [1, 4]))).toEqual({
      repeat: "weekly",
      interval: "2",
      weekdays: ["1", "4"],
    });
    expect(recurrenceToFormValues(null)).toEqual({ repeat: "none", interval: "1", weekdays: [] });
  });
});

describe("describeRecurrence", () => {
  it.each([
    [daily(), "Repeats every day"],
    [daily(3), "Repeats every 3 days"],
    [weekly(), "Repeats every week"],
    [weekly(2), "Repeats every 2 weeks"],
    [weekly(1, [1, 4]), "Repeats every week on Mon, Thu"],
    [weekly(2, [7]), "Repeats every 2 weeks on Sun"],
    [monthly(), "Repeats every month"],
    [monthly(6), "Repeats every 6 months"],
  ])("says %j in words", (rule, words) => {
    expect(describeRecurrence(rule)).toBe(words);
  });
});
