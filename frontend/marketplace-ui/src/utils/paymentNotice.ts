const NOTICE_PREFIX = 'marketplace:payment-notice:';

export const setPaymentNotice = (orderId: string, message: string): void => {
  try {
    sessionStorage.setItem(`${NOTICE_PREFIX}${orderId}`, message);
  } catch {
    // Storage can be unavailable in private browsing or server-side rendering.
  }
};

export const takePaymentNotice = (orderId: string): string | null => {
  try {
    const key = `${NOTICE_PREFIX}${orderId}`;
    const message = sessionStorage.getItem(key);
    if (message) {
      sessionStorage.removeItem(key);
    }
    return message;
  } catch {
    return null;
  }
};
