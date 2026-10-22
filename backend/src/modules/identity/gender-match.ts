/**
 * Whether the gender on the Aadhaar agrees with the profile. The profile offers M and F only, so an Aadhaar that says
 * T (transgender) or nothing never counts as a mismatch.
 */
export function genderMatches(aadhaarGender: string | null | undefined, profileGender: 'M' | 'F'): boolean {
  return aadhaarGender !== 'M' && aadhaarGender !== 'F' ? true : aadhaarGender === profileGender;
}
