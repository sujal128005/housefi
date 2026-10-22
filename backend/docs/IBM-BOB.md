# How Housefi used IBM Bob: the payout kit

**In one line:** IBM Bob built a stand-alone "payout kit" library. We reviewed it, fixed what the review found, and built it into Housefi, where it now makes the weekly bank-transfer files for technician payouts.

## Why
Every Monday, Housefi pays its technicians for the week before. Each payment used to be made by hand, one transfer at a time. We wanted:
- one file per week that the bank's bulk-transfer page can import;
- every bank account, IFSC and UPI ID checked **before** any money moves.

## What we asked IBM Bob to build
A self-contained TypeScript library, `payout-kit`, with:
- no runtime dependencies, money in integer paise, and pure functions;
- checks for every payout (amount, holder name, account number, IFSC, UPI ID, date);
- batch checks (repeated payouts, the same account used twice);
- configurable bank-file layouts (NEFT and UPI) that are safe against spreadsheet formula injection;
- a plain-English summary that never shows full account numbers;
- a command-line tool, at least 40 tests, a README, examples, and a log of its own work (`BOB-REPORT.md`).

Bob was **not** given the Housefi code: the prompt described only the problem.

## What IBM Bob delivered
- **Plan:** source files `types`, `utils`, `validate`, `bankFile`, `summary`, `cli`; tests for utilities, validation, bank files and an end-to-end batch; README, examples and `BOB-REPORT.md`.
- **Code:**
  - a regex-based validator and duplicate detection;
  - a config-driven CSV builder with formula-injection escaping;
  - Indian rupee formatting, masking of account numbers and UPI IDs, and ISO week numbers;
  - the command-line tool.
- **Tests:** 30 test cases (12 utility, 17 validation, 1 end-to-end).
- **Documents:** a README, sample payouts and their output files, and `BOB-REPORT.md` (security notes and open items).

## What our review found, and what we changed
1. **The test run Bob showed was not real.** Its output was labelled "MOCK EXECUTION RESULTS" and claimed 40 tests, but 30 were written. We ran every test ourselves (below) and added more.
2. **Privacy:** UPI IDs with short names were shown in full. Now a name of 1–2 letters is hidden completely, and longer ones show only the first letter.
3. **Privacy:** the duplicate-account warnings contained full account numbers, which were only masked later, in the summary. Now they are masked at the source.
4. **Side effect:** the batch check changed the caller's data (it upper-cased the IFSC in place). Now it returns a normalised copy and never changes its input.
5. **UPI IDs:** the check accepted any characters before the `@`, including spaces. Now only letters, digits, dots, dashes and underscores are allowed.
6. **Missing features:** the layout options (`delimiter`, `includeHeader`, `lineEnding`) and the `--format` / `--max-amount` flags were in the brief but not built. Layouts are now real configuration, and the file uses Windows line endings (CRLF), which bank portals and spreadsheets expect.
7. **Money accuracy:** rupee amounts were formatted using decimal fractions. Now integer arithmetic gives exact results at any size.
8. **Fit to Housefi:**
   - Housefi pays Monday to Sunday, so the kit names the paid week by its Sunday;
   - transfer references are upper-case;
   - the command-line tool is not needed: HQ does it with one button.

The kit's design (plain functions, layouts as data, masking, the summary) is Bob's. The adapted code is in `backend/src/modules/earnings/payout-kit/`, and each file says it was first built with IBM Bob.

## How it is built into Housefi
- **Technician app → Profile → Payout details** (`app/src/app/tech/payout.tsx`):
  - the technician chooses a bank account (number typed twice, plus IFSC) or a UPI ID;
  - the same checks run in the app (`app/src/domain/payout.ts`), with messages in English and Telugu.
- **Server** (`backend/src/modules/earnings/payout-accounts.service.ts`, `GET`/`PUT /v1/tech/payout-account`):
  - the details are checked again by the kit;
  - the account number, UPI ID and holder name are stored encrypted (table `technician_payout_accounts`); only a masked hint such as `XXXXXX1234 · SBIN0001234` is readable;
  - every change is in the audit log;
  - deleting the account deletes the details.
- **Housefi HQ → Payouts → "Download bank files"** (`POST /v1/admin/payouts/bank-files`):
  - after "Prepare payouts", one file for bank transfers and one for UPI, made by the kit;
  - payouts without details, or with details the kit refuses, are left out and listed with the reason;
  - details changed in the last 48 hours are flagged "confirm with them by phone before paying", because a changed account is how payout fraud usually starts;
  - the export is audited with counts only, never account numbers.

## Tests (all run for real)
- **Payout kit:** 52 tests in `payout-kit.spec.ts`. These are Bob's cases, adapted, plus cases for each fix above.
- **Server:** 8 end-to-end tests in `test/payout-accounts.e2e-spec.ts`, covering:
  - saving, masking and encryption;
  - wrong details refused;
  - switching from bank to UPI;
  - technicians only;
  - deleted with the account;
  - the bank files, with left-out payouts and recent-change warnings;
  - nothing to pay;
  - admins only.
- **App:**
  - the payout checks (`payout.test.ts`);
  - the live client calls (`httpBackend.test.ts`);
  - English and Telugu strings.
- **HQ portal:** build and tests.

## Before the first real payment
The two layouts are generic. Download a file, compare its columns with the bank's own bulk-upload template, and add a layout for that bank in `payout-kit/bank-file.ts` (`LAYOUTS`). This is the same warning Bob's README gave.
