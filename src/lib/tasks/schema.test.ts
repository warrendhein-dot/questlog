import { describe, expect, it } from "vitest";
import { EMPTY_TASK_FORM, parseTaskForm, parseTaskId, toFormValues, type Task } from "./schema";

function form(fields: Record<string, string | Blob>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const valid = {
  title: "Slay the inbox",
  notes: "",
  category: "work",
  priority: "normal",
  dueDate: "",
};

describe("parseTaskForm: valid input", () => {
  it("accepts a complete form", () => {
    const result = parseTaskForm(
      form({ ...valid, notes: "Zero unread", priority: "high", dueDate: "2026-12-24" }),
    );
    expect(result).toEqual({
      success: true,
      data: {
        title: "Slay the inbox",
        notes: "Zero unread",
        category: "work",
        priority: "high",
        dueDate: "2026-12-24",
      },
    });
  });

  it("trims whitespace and turns an empty due date into null", () => {
    const result = parseTaskForm(
      form({ ...valid, title: "  Pay rent  ", notes: " x ", dueDate: " " }),
    );
    expect(result).toMatchObject({
      success: true,
      data: { title: "Pay rent", notes: "x", dueDate: null },
    });
  });

  it("accepts the limits exactly", () => {
    const result = parseTaskForm(
      form({ ...valid, title: "t".repeat(200), notes: "n".repeat(5000), dueDate: "2100-12-31" }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts every category and priority", () => {
    for (const category of ["work", "health", "learning", "home", "social"]) {
      expect(parseTaskForm(form({ ...valid, category })).success).toBe(true);
    }
    for (const priority of ["low", "normal", "high"]) {
      expect(parseTaskForm(form({ ...valid, priority })).success).toBe(true);
    }
  });

  it("ignores extra fields someone added to the submission", () => {
    const result = parseTaskForm(
      form({ ...valid, user_id: "someone-else", completed_at: "2026-01-01" }),
    );
    expect(result).toMatchObject({ success: true });
    expect(result.success && Object.keys(result.data).sort()).toEqual([
      "category",
      "dueDate",
      "notes",
      "priority",
      "title",
    ]);
  });
});

describe("parseTaskForm: invalid input", () => {
  const errorsFor = (fields: Record<string, string | Blob>) => {
    const result = parseTaskForm(form(fields));
    if (result.success) throw new Error("expected the form to be rejected");
    return result;
  };

  it.each([
    ["an empty title", { title: "" }, "title"],
    ["a whitespace-only title", { title: "   " }, "title"],
    ["a title over 200 characters", { title: "t".repeat(201) }, "title"],
    ["notes over 5000 characters", { notes: "n".repeat(5001) }, "notes"],
    ["an unknown category", { category: "combat" }, "category"],
    ["an unknown priority", { priority: "urgent" }, "priority"],
    ["text instead of a date", { dueDate: "tomorrow" }, "dueDate"],
    ["a date that does not exist", { dueDate: "2026-02-30" }, "dueDate"],
    ["a date before 2000", { dueDate: "1999-12-31" }, "dueDate"],
    ["a date after 2100", { dueDate: "2101-01-01" }, "dueDate"],
    ["a date with a time attached", { dueDate: "2026-12-24T10:00:00Z" }, "dueDate"],
  ])("rejects %s", (_label, change, field) => {
    const result = errorsFor({ ...valid, ...change });
    expect(Object.keys(result.errors)).toEqual([field]);
  });

  it("treats missing fields as missing, not as errors in the code", () => {
    const result = errorsFor({});
    expect(Object.keys(result.errors).sort()).toEqual(["category", "priority", "title"]);
  });

  it("treats a file upload in a text field as missing", () => {
    const result = errorsFor({ ...valid, title: new Blob(["evil"], { type: "text/plain" }) });
    expect(result.errors.title).toBe("Give the quest a name.");
  });

  it("hands back what was typed so the form can show it again", () => {
    const result = errorsFor({ ...valid, title: "", notes: "Keep me" });
    expect(result.values).toEqual({ ...valid, title: "", notes: "Keep me" });
  });

  it("reports only the first problem per field", () => {
    const result = errorsFor({ ...valid, title: " " });
    expect(typeof result.errors.title).toBe("string");
  });
});

describe("parseTaskId", () => {
  it("accepts a UUID", () => {
    expect(parseTaskId("123e4567-e89b-42d3-a456-426614174000")).toBe(
      "123e4567-e89b-42d3-a456-426614174000",
    );
  });

  it.each([null, undefined, 42, "", "not-a-uuid", "1; drop table tasks", "../../etc/passwd", {}])(
    "rejects %j",
    (value) => {
      expect(parseTaskId(value)).toBeNull();
    },
  );
});

describe("toFormValues", () => {
  const task: Task = {
    id: "123e4567-e89b-42d3-a456-426614174000",
    title: "Pay rent",
    notes: "Before the 1st",
    category: "home",
    priority: "high",
    dueDate: "2026-11-01",
    completedAt: null,
  };

  it("turns a task into form values", () => {
    expect(toFormValues(task)).toEqual({
      title: "Pay rent",
      notes: "Before the 1st",
      category: "home",
      priority: "high",
      dueDate: "2026-11-01",
    });
  });

  it("shows no date as an empty field", () => {
    expect(toFormValues({ ...task, dueDate: null }).dueDate).toBe("");
  });

  it("has sensible defaults for a new quest", () => {
    expect(EMPTY_TASK_FORM).toEqual({
      title: "",
      notes: "",
      category: "work",
      priority: "normal",
      dueDate: "",
    });
  });
});
