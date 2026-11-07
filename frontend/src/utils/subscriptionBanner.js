// The subscription banner comes from the server in English with a `code` (+ `vars`); show it in the user's language,
// falling back to the server's text for a code this build doesn't know.
export const bannerText = (t, b) => (!b ? '' : b.code ? t(`ui.subscriptionBanner.${b.code}`, { ...b.vars, defaultValue: b.text }) : b.text)
export const bannerAction = (t, b) => (!b?.action ? null : b.actionCode ? t(`ui.subscriptionBanner.action.${b.actionCode}`, { defaultValue: b.action }) : b.action)
