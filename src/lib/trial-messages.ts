// Human wording for every reason claim_trial() can answer with. Lives
// outside the server action module because a "use server" file may only
// export async functions.
export const CLAIM_MESSAGES: Record<string, string> = {
  phone_unverified:
    "We couldn't confirm that number. Send the code again and enter it exactly as received.",
  phone_invalid: "Enter a valid mobile number.",
  gstin_invalid: "That GSTIN doesn't look right. It has 15 characters, like 27AAPFU0939F1ZV.",
  phone: "This mobile number already activated a trial for another hotel.",
  gstin: "This GSTIN already activated a trial for another hotel.",
  already_denied: "This hotel's trial was already refused.",
  similar_name:
    "A hotel with a very similar name already uses fast_menu in your area, so we're checking this one by hand.",
};
