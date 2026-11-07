# Gotenberg with the Noto fonts for every script the app prints in: Devanagari (Hindi,
# Marathi), Bengali, Gujarati, Gurmukhi (Punjabi), Kannada, Malayalam, Oriya, Tamil, Telugu
# and Noto Nastaliq Urdu. Prints can't fetch web fonts (Chromium's deny-list blocks http(s)),
# so the glyphs must be installed in the image or Indic text comes out as empty boxes.
FROM gotenberg/gotenberg:8

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-noto-core fonts-noto-ui-core fonts-noto-extra \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f
USER gotenberg
