import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { saveTimeZone } = vi.hoisted(() => ({ saveTimeZone: vi.fn() }));
vi.mock("@/app/profile/actions", () => ({ saveTimeZone }));

import { TimeZoneSync } from "./time-zone-sync";

/** Makes the browser report this time zone (or fail to say). */
function browserReports(timeZone: string | (() => never)) {
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation((() => ({
    resolvedOptions: () => (typeof timeZone === "function" ? timeZone() : { timeZone }),
  })) as unknown as typeof Intl.DateTimeFormat);
}

beforeEach(() => {
  saveTimeZone.mockReset();
  saveTimeZone.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TimeZoneSync", () => {
  it("shows nothing at all", () => {
    browserReports("UTC");
    const { container } = render(<TimeZoneSync savedZone="UTC" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("saves the browser's time zone when it differs from the saved one", async () => {
    browserReports("Africa/Johannesburg");
    render(<TimeZoneSync savedZone="UTC" />);
    await waitFor(() => expect(saveTimeZone).toHaveBeenCalledWith("Africa/Johannesburg"));
    expect(saveTimeZone).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the saved time zone already matches", async () => {
    browserReports("Africa/Johannesburg");
    render(<TimeZoneSync savedZone="Africa/Johannesburg" />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(saveTimeZone).not.toHaveBeenCalled();
  });

  it("keeps the saved zone when the browser cannot say what its zone is", async () => {
    browserReports(() => {
      throw new Error("no Intl");
    });
    render(<TimeZoneSync savedZone="UTC" />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(saveTimeZone).not.toHaveBeenCalled();
  });

  it("keeps the saved zone when the browser reports an empty name", async () => {
    browserReports("");
    render(<TimeZoneSync savedZone="UTC" />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(saveTimeZone).not.toHaveBeenCalled();
  });

  it("does not break the page when saving fails", async () => {
    browserReports("Africa/Johannesburg");
    saveTimeZone.mockRejectedValue(new Error("Could not save your time zone"));
    expect(() => render(<TimeZoneSync savedZone="UTC" />)).not.toThrow();
    await waitFor(() => expect(saveTimeZone).toHaveBeenCalled());
  });

  it("does not ask again when the page redraws with the same saved zone", async () => {
    browserReports("Africa/Johannesburg");
    const { rerender } = render(<TimeZoneSync savedZone="UTC" />);
    await waitFor(() => expect(saveTimeZone).toHaveBeenCalledTimes(1));
    rerender(<TimeZoneSync savedZone="UTC" />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(saveTimeZone).toHaveBeenCalledTimes(1);
  });
});
