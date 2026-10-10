import { describe, expect, it } from "vitest";
import { describeDatabaseUrlProblem as check } from "@/lib/db";

const GOOD = "postgresql://postgres.abcdefghijklmnopqrst:Password123@aws-0-ap-south-1.pooler.supabase.com:6543/postgres";

describe("DATABASE_URL checks (never reveal the password)", () => {
  it("accepts a well-formed Supabase pooler URL", () => expect(check(GOOD)).toBeNull());
  it("explains common paste mistakes", () => {
    expect(check(GOOD.replace("Password123", "[YOUR-PASSWORD]"))).toMatch(/brackets/);
    expect(check("DATABASE_URL=" + GOOD)).toMatch(/starts with 'DATABASE_URL='/);
    expect(check("https://abcdefghijklmnopqrst.supabase.co")).toMatch(/https:\/\/ project link/);
    expect(check(` ${GOOD}\n`)).toMatch(/spaces or a line break/);
    expect(check(`"${GOOD}"`)).toMatch(/quote marks/);
    expect(check(GOOD.replace("Password123", "Pass@word"))).toMatch(/contains '@'/);
    expect(check(GOOD.replace("Password123", "Pass#word"))).toMatch(/special character/);
  });
  it("never includes the password in the message", () => {
    expect(check(GOOD.replace("Password123", "S3cret#Value"))).not.toMatch(/S3cret/);
  });
});
