// Razorpay Checkout: the browser only opens Razorpay's own window; the server makes the order and
// checks the signed response. Used by the patient portal (an institution's gateway) and by Subscription
// & billing (the platform's account).
const CHECKOUT_JS = 'https://checkout.razorpay.com/v1/checkout.js'
let loading = null

/** Load checkout.js once. `failMessage` is the error shown when it can't load (blocked, offline). */
export function loadCheckout(failMessage) {
  if (window.Razorpay) return Promise.resolve()
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = CHECKOUT_JS
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => { loading = null; reject(new Error(failMessage)) }
    document.body.appendChild(s)
  })
  return loading
}
