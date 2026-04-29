export const deriveUsernameFromEmail = (email: string): string => {
  const localPart = email.trim().toLowerCase().split('@')[0] || '';
  return localPart.replace(/[^a-z0-9]/g, '');
};
