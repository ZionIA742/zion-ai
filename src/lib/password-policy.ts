export type PasswordPolicyValidation = {
  isValid: boolean;
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
  notOnlyWhitespace: boolean;
};

export function validatePasswordPolicy(password: string): PasswordPolicyValidation {
  const value = String(password ?? "");
  const trimmed = value.trim();

  const result = {
    minLength: trimmed.length >= 8,
    hasUppercase: /[A-Z]/.test(value),
    hasLowercase: /[a-z]/.test(value),
    hasNumber: /\d/.test(value),
    hasSpecial: /[^A-Za-z0-9\s]/.test(value),
    notOnlyWhitespace: trimmed.length > 0,
  };

  return {
    ...result,
    isValid:
      result.minLength &&
      result.hasUppercase &&
      result.hasLowercase &&
      result.hasNumber &&
      result.hasSpecial &&
      result.notOnlyWhitespace,
  };
}
