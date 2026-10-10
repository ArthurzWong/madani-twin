/**
 * UI smoke tests: the app mounts and shows the mandatory calculated values,
 * scenario switching works, and reset restores the demo state.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import App from "../src/App";

// jsdom lacks matchMedia/scrollTo — not needed here.
beforeEach(() => {
  cleanup();
  try { window.localStorage.clear(); } catch { /* noop */ }
});

describe("App UI", () => {
  it("mounts and shows the mandatory downside numbers on first load", () => {
    render(<App />);
    // Banner
    expect(screen.getByText(/Illustrative synthetic SME scenario/i)).toBeTruthy();
    // Downside is the default scenario: RM5,000 Day-7 shortfall appears in the
    // comparison table and scenario min; check a few engine-computed figures.
    expect(screen.getAllByText("RM5,000.00")).toBeTruthy();          // downside min / shortfall
    expect(screen.getAllByText("RM25,000.00")).toBeTruthy();          // baseline day 7 / min
    expect(screen.getAllByText("RM50,000.00")).toBeTruthy();          // opening cash
    expect(screen.getAllByText(/Payment Guardian/i)).toBeTruthy();
  });

  it("scenario switch shows intervention values after clicking Intervention", () => {
    render(<App />);
    const btn = screen.getByRole("radio", { name: /Intervention/i });
    fireEvent.click(btn);
    // Intervention min = RM15,000 on Day 7; comparison table still shows RM25,000 (baseline).
    expect(screen.getAllByText("RM15,000.00")).toBeTruthy();
  });

  it("tabs navigate: evaluation table renders with pass counts", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /Forecast & Evaluation/i }));
    expect(screen.getByText(/Synthetic test battery/i)).toBeTruthy();
    expect(screen.getByText(/24\/24 passing/i)).toBeTruthy();
    expect(screen.getByText(/31\/31 passing/i)).toBeTruthy();
  });

  it("run demo (reset) restores the mandatory state after user edits", () => {
    render(<App />);
    // Switch to Intervention, then Run Demo -> returns to downside default with RM5,000 visible.
    fireEvent.click(screen.getByRole("radio", { name: /Intervention/i }));
    fireEvent.click(screen.getByRole("button", { name: /Run MADANI Demo/i }));
    expect(screen.getAllByText("RM5,000.00")).toBeTruthy();
  });
});
