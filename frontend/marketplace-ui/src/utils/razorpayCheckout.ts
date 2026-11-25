export interface RazorpayPaymentResult {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface RazorpayCheckoutConfig {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  order_id: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  notes?: Record<string, string>;
  theme?: {
    color?: string;
  };
}

interface RazorpayCheckoutOptions extends RazorpayCheckoutConfig {
  handler: (response: RazorpayPaymentResult) => void;
  modal?: {
    ondismiss?: () => void;
    confirm_close?: boolean;
    escape?: boolean;
  };
}

interface RazorpayCheckoutInstance {
  open: () => void;
  close: () => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;
    __razorpayCheckoutPromise?: Promise<boolean>;
  }
}

const RAZORPAY_SCRIPT_ID = 'razorpay-checkout-script';
const RAZORPAY_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

export const loadRazorpayCheckout = (): Promise<boolean> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(false);
  }

  if (window.Razorpay) {
    return Promise.resolve(true);
  }

  if (window.__razorpayCheckoutPromise) {
    return window.__razorpayCheckoutPromise;
  }

  window.__razorpayCheckoutPromise = new Promise<boolean>((resolve) => {
    const existing = document.getElementById(RAZORPAY_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing || document.createElement('script');

    const handleLoad = () => resolve(Boolean(window.Razorpay));
    const handleError = () => {
      window.__razorpayCheckoutPromise = undefined;
      script.remove();
      resolve(false);
    };

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });

    if (!existing) {
      script.id = RAZORPAY_SCRIPT_ID;
      script.src = RAZORPAY_SCRIPT_SRC;
      script.async = true;
      (document.body || document.head).appendChild(script);
    }
  });

  return window.__razorpayCheckoutPromise;
};

export const openRazorpayCheckout = (
  config: RazorpayCheckoutConfig
): Promise<RazorpayPaymentResult | null> => {
  if (typeof window === 'undefined' || !window.Razorpay) {
    return Promise.reject(new Error('Secure payment checkout is unavailable. Please try again.'));
  }

  return new Promise<RazorpayPaymentResult | null>((resolve, reject) => {
    let settled = false;

    const finish = (result: RazorpayPaymentResult | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      const checkout = new window.Razorpay({
        ...config,
        handler: (response) => finish(response),
        modal: {
          confirm_close: true,
          ondismiss: () => finish(null),
        },
      });
      checkout.open();
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Secure payment checkout could not be opened.'));
    }
  });
};
