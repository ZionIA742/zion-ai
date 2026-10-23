import { strict as assert } from "node:assert";
const { monthlyAllocation, applicableFixedCosts, parseCostPeriod, classifyCostRun, monthlyAccrual, toKnownCostNumber, classifyCostCompleteness, formatCostMetric } = await import(
  new URL("./zion-admin-costs.ts", import.meta.url).href
) as typeof import("./zion-admin-costs");
assert.equal(Array.from({length:12},(_,i)=>monthlyAllocation(4000,"annual",i+1)).reduce((a,b)=>a+b,0),4000);
assert.equal(monthlyAllocation(10400,"monthly",1),10400);
const rows = [
 {cost_id:"1",effective_month:"2026-10-01",name:"Vercel",amount_cents:10000,frequency:"monthly" as const,enabled:true},
 {cost_id:"1",effective_month:"2026-12-01",name:"Vercel",amount_cents:12000,frequency:"monthly" as const,enabled:true},
 {cost_id:"1",effective_month:"2027-01-01",name:"Vercel",amount_cents:12000,frequency:"monthly" as const,enabled:false},
];
assert.equal(applicableFixedCosts(rows,"2026-11-01")[0].monthly_cents,10000);
assert.equal(applicableFixedCosts(rows,"2026-12-01")[0].monthly_cents,12000);
assert.equal(applicableFixedCosts(rows,"2027-01-01").length,0);
assert.equal(parseCostPeriod("month","2026-10-20").start,"2026-10-01T03:00:00.000Z");
assert.equal(parseCostPeriod("week","2026-10-20").start,"2026-10-19T03:00:00.000Z");
assert.equal(parseCostPeriod("day","2026-10-20").end,"2026-10-21T03:00:00.000Z");
assert.equal(parseCostPeriod("year","2026-10-20").end,"2027-01-01T03:00:00.000Z");
assert.equal(classifyCostRun({input:{source:"assistant_chat"}}),"assistant");
assert.equal(classifyCostRun({input:{source:"ai_sales"}}),"sales");
assert.equal(classifyCostRun({input:{source:"unknown"}}),"unclassified");
assert.equal(toKnownCostNumber(null), null);
assert.equal(toKnownCostNumber(""), null);
assert.equal(toKnownCostNumber("   "), null);
assert.equal(toKnownCostNumber("invalid"), null);
assert.equal(toKnownCostNumber(Infinity), null);
assert.equal(toKnownCostNumber(0), 0);
assert.equal(toKnownCostNumber("0"), 0);
assert.equal(toKnownCostNumber("1.25"), 1.25);
assert.equal(classifyCostCompleteness(0, "available", true), "no_runs");
assert.equal(classifyCostCompleteness(1, "available", true), "complete");
assert.equal(classifyCostCompleteness(1, "available", false), "incomplete");
assert.equal(classifyCostCompleteness(1, "partial", true), "incomplete");
assert.equal(formatCostMetric(0, "available", "complete", (value) => `USD ${value}`), "USD 0");
assert.equal(formatCostMetric(0, "available", "no_runs", (value) => `USD ${value}`), "Sem execuções");
assert.equal(formatCostMetric(0, "available", "incomplete", (value) => `USD ${value}`), "Incompleto");
assert.equal(formatCostMetric(0, "partial", "complete", (value) => `USD ${value}`), "Parcial");
assert.equal(formatCostMetric(0, "unavailable", "complete", (value) => `USD ${value}`), "Indisponível");
assert.equal(formatCostMetric(0, undefined, "complete", (value) => `USD ${value}`), "Indisponível");
console.log("zion-admin-costs: accounting tests passed");

// Initial expenses begin on Nov 23, but November recognizes the FULL monthly amount.
const start = "2026-11-23";
assert.equal(monthlyAccrual(30400,"2026-11-01","2026-11-01","2026-11-23",start),0);
assert.equal(monthlyAccrual(30400,"2026-11-01","2026-11-23","2026-12-01",start),30400);
assert.equal(monthlyAccrual(30400,"2026-11-01","2026-11-01","2026-12-01",start),30400);
assert.equal(monthlyAccrual(30400,"2026-11-01","2026-11-23","2026-11-24",start),3800);
assert.equal(monthlyAccrual(30400,"2026-12-01","2026-12-01","2027-01-01",start),30400);
assert.equal(monthlyAccrual(30400,"2026-10-01","2026-10-01","2026-11-01",start),0);
assert.equal(Array.from({length:8},(_,i)=>monthlyAccrual(333,"2026-11-01",`2026-11-${String(23+i).padStart(2,"0")}`,`2026-${i===7?"12-01":"11-"+String(24+i).padStart(2,"0")}`,start)).reduce((a,b)=>a+b,0),333);

// Complete month coverage is essential for day/week and cross-month summaries.
assert.equal(parseCostPeriod("day","2026-11-24").endMonthExclusive,"2026-12-01");
assert.equal(parseCostPeriod("week","2026-11-24").endMonthExclusive,"2026-12-01");
assert.equal(parseCostPeriod("week","2026-11-30").startMonth,"2026-11-01");
assert.equal(parseCostPeriod("week","2026-11-30").endMonthExclusive,"2027-01-01");
assert.equal(parseCostPeriod("year","2026-10-20").endMonthExclusive,"2027-01-01");
