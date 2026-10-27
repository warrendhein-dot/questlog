import { describe, expect, it } from "vitest";
import { allStepsDone, parseSubtaskForm, parseSubtaskId } from "./schema";

function form(fields: Record<string, string | Blob>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("parseSubtaskForm", () => {
  it("accepts a name and trims it", () => {
    expect(parseSubtaskForm(form({ title: "  Book the venue  " }))).toEqual({
      success: true,
      title: "Book the venue",
    });
  });

  it("accepts exactly 200 characters", () => {
    expect(parseSubtaskForm(form({ title: "x".repeat(200) })).success).toBe(true);
  });

  it.each([
    ["empty", "", "Give the step a name."],
    ["only spaces", "   ", "Give the step a name."],
    ["over 200 characters", "x".repeat(201), "Keep the step to 200 characters or fewer."],
  ])("rejects a name that is %s, and hands back what was typed", (_label, title, message) => {
    expect(parseSubtaskForm(form({ title }))).toEqual({ success: false, message, value: title });
  });

  it("treats a missing field or a file upload as empty", () => {
    expect(parseSubtaskForm(form({}))).toMatchObject({ success: false, value: "" });
    expect(parseSubtaskForm(form({ title: new Blob(["x"]) }))).toMatchObject({
      success: false,
      value: "",
    });
  });

  it("ignores extra fields someone added by hand", () => {
    expect(
      parseSubtaskForm(
        form({ title: "Step", user_id: "someone-else", completed_at: "2020-01-01" }),
      ),
    ).toEqual({ success: true, title: "Step" });
  });
});

describe("parseSubtaskId", () => {
  it("accepts a UUID", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(parseSubtaskId(id)).toBe(id);
  });

  it.each(["", "nope", "1; drop table subtasks", null, undefined, 42])("rejects %s", (value) => {
    expect(parseSubtaskId(value)).toBeNull();
  });
});

describe("allStepsDone", () => {
  it("is false when there are no steps, so an empty quest is never offered completion", () => {
    expect(allStepsDone([])).toBe(false);
  });

  it("is false while any step is open", () => {
    expect(allStepsDone([{ completedAt: "2026-10-27T08:00:00Z" }, { completedAt: null }])).toBe(
      false,
    );
  });

  it("is true when every step is ticked", () => {
    expect(allStepsDone([{ completedAt: "2026-10-27T08:00:00Z" }])).toBe(true);
  });
});
