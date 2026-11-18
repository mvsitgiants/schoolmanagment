// Starter help articles (Superadmin › Help articles › Add the starter articles). Written for screens whose steps are
// known exactly; the team reads them, changes what it likes and publishes. English is the article; `translations.hi`
// its Hindi. Body: plain lines, "1." / "-" lists and **bold**.

export const STARTER_HELP_ARTICLES = [
  {
    slug: 'admit-a-student', module: 'students', pages: ['students.admit'], order: 10,
    title: 'Admit a new student',
    summary: 'Fill in the form, check it on the review page, and admit.',
    body: `1. Open **Students › New admission**.
2. Pick the **class and section**. The admission number comes from the number series unless you type one.
3. Fill in the student's name, at least one parent or guardian, and anything else you have. The rest can be added later from the student's profile.
4. Under **Documents**, add the papers the campus asks for — upload a PDF or take a photo.
5. Press **Review admission**, read everything once more, then **Confirm and admit**.

The student's profile (Student 360) opens after admission.`,
    translations: { hi: {
      title: 'नए विद्यार्थी का प्रवेश करें',
      summary: 'फ़ॉर्म भरें, समीक्षा पृष्ठ पर जाँचें और प्रवेश दें।',
      body: `1. **विद्यार्थी › नया प्रवेश** खोलें।
2. **कक्षा और अनुभाग** चुनें। प्रवेश संख्या स्वतः क्रमांक शृंखला से आती है, जब तक आप स्वयं न लिखें।
3. विद्यार्थी का नाम, कम से कम एक माता-पिता या अभिभावक और जो भी जानकारी उपलब्ध हो, भरें। शेष विवरण बाद में विद्यार्थी की प्रोफ़ाइल से जोड़ा जा सकता है।
4. **दस्तावेज़** में परिसर द्वारा माँगे गए कागज़ जोड़ें — पीडीएफ़ जोड़ें या फ़ोटो लें।
5. **प्रवेश की समीक्षा करें** दबाएँ, सब कुछ एक बार फिर पढ़ें, फिर **पुष्टि करें और प्रवेश दें** दबाएँ।

प्रवेश के बाद विद्यार्थी की प्रोफ़ाइल (विद्यार्थी 360) खुलती है।` } },
  },
  {
    slug: 'send-admission-form-to-family', module: 'students', pages: ['students.admit'], order: 20,
    title: 'Send the admission form to a family',
    summary: 'The family fills in the details and adds documents from their phone.',
    body: `1. On **New admission**, press **Send form to family**.
2. Type the child's and parent's names, the parent's mobile and/or email, and the class if you know it.
3. Choose **WhatsApp**, **SMS** or **Email** — or choose none and press **Make link** to share it yourself.
4. The family opens the link, fills in the form, adds photos of the documents and sends it.

The link works for the days set in **Settings › Links sent to families work for**. Sending again makes a new link; the old one stops working.`,
    translations: { hi: {
      title: 'परिवार को प्रवेश फ़ॉर्म भेजें',
      summary: 'परिवार अपने फ़ोन से विवरण भरता है और दस्तावेज़ जोड़ता है।',
      body: `1. **नया प्रवेश** पृष्ठ पर **परिवार को फ़ॉर्म भेजें** दबाएँ।
2. बच्चे और अभिभावक का नाम, अभिभावक का मोबाइल और/या ईमेल, और कक्षा (यदि तय हो) लिखें।
3. **व्हाट्सऐप**, **एसएमएस** या **ईमेल** चुनें — या कोई माध्यम न चुनकर **लिंक बनाएँ** दबाएँ और स्वयं साझा करें।
4. परिवार लिंक खोलकर फ़ॉर्म भरता है, दस्तावेज़ों की फ़ोटो जोड़ता है और भेज देता है।

लिंक **सेटिंग्स** में तय दिनों तक काम करता है। पुनः भेजने पर नया लिंक बनता है और पुराना लिंक बंद हो जाता है।` } },
  },
  {
    slug: 'admit-from-family-form', module: 'students', pages: ['students.admit'], order: 30,
    title: 'Check a form a family filled, and admit',
    summary: 'Open it from "Forms from families", check, pick the class and admit.',
    body: `1. On **New admission**, look at **Forms from families** on the right.
2. Press **Open** on a filled form. Their details fill the admission form and their documents appear under **Documents**.
3. Check every detail, pick the **class and section**, and correct anything that is wrong.
4. Press **Review admission**, then **Confirm and admit**.

Their documents move to the student's record. A form still waiting can be sent again or closed from the same panel.`,
    translations: { hi: {
      title: 'परिवार द्वारा भरा फ़ॉर्म जाँचें और प्रवेश दें',
      summary: '“परिवारों से आए फ़ॉर्म” से खोलें, जाँचें, कक्षा चुनें और प्रवेश दें।',
      body: `1. **नया प्रवेश** पृष्ठ पर दाईं ओर **परिवारों से आए फ़ॉर्म** देखें।
2. भरे गए फ़ॉर्म पर **खोलें** दबाएँ। उनका विवरण प्रवेश फ़ॉर्म में भर जाता है और दस्तावेज़ **दस्तावेज़** में दिखते हैं।
3. प्रत्येक विवरण जाँचें, **कक्षा और अनुभाग** चुनें और जो गलत हो उसे सुधारें।
4. **प्रवेश की समीक्षा करें**, फिर **पुष्टि करें और प्रवेश दें** दबाएँ।

उनके दस्तावेज़ विद्यार्थी के अभिलेख में चले जाते हैं। प्रतीक्षारत फ़ॉर्म उसी पैनल से पुनः भेजा या बंद किया जा सकता है।` } },
  },
  {
    slug: 'tc-name-or-dob-differs', module: 'students', pages: ['students.admit', 'students.profile'], order: 40,
    title: 'When the TC’s name or date of birth is different',
    summary: 'The form warns you; write why before saving.',
    body: `Under **Previous school**, type the **name on the TC** and the **date of birth on the TC** exactly as written.

If either is different from the student's details, a warning shows the difference. Saving then needs **Why the TC is different** — for example "spelling corrected by affidavit". The reason is kept on the student's record.

If the difference is a typing mistake, correct the student's name or date of birth instead.`,
    translations: { hi: {
      title: 'जब टीसी पर नाम या जन्मतिथि भिन्न हो',
      summary: 'फ़ॉर्म चेतावनी दिखाता है; सहेजने से पहले कारण लिखें।',
      body: `**पिछला विद्यालय** में **टीसी पर लिखा नाम** और **टीसी पर लिखी जन्मतिथि** ठीक वैसी ही लिखें, जैसी लिखी है।

यदि इनमें से कोई विद्यार्थी के विवरण से भिन्न है, तो चेतावनी में अंतर दिखाया जाता है। तब सहेजने के लिए **टीसी भिन्न होने का कारण** लिखना आवश्यक है — जैसे “शपथपत्र द्वारा वर्तनी सुधारी गई”। यह कारण विद्यार्थी के अभिलेख में रखा जाता है।

यदि अंतर टाइपिंग की गलती है, तो विद्यार्थी का नाम या जन्मतिथि सुधारें।` } },
  },
  {
    slug: 'student-documents-verify', module: 'students', pages: ['students.profile'], order: 50,
    title: 'Add documents later and mark them verified',
    summary: 'Student 360 › Documents shows what is in, what is pending, and what is checked.',
    body: `1. Open the student's **Student 360** and the **Documents** tab.
2. The campus's list shows each document: in, or still pending.
3. To add one, press **Upload file** or **Take photo** on its row. For Aadhaar and other cards, add the **front** and the **back**.
4. After seeing the original, press the **tick** to mark it **Verified**, or the **cross** for **Not accepted** with the reason.

Who checked it and when is kept with the document.`,
    translations: { hi: {
      title: 'दस्तावेज़ बाद में जोड़ें और सत्यापित करें',
      summary: 'विद्यार्थी 360 › दस्तावेज़ में दिखता है कि क्या प्राप्त है, क्या शेष है और क्या जाँचा गया।',
      body: `1. विद्यार्थी का **विद्यार्थी 360** और **दस्तावेज़** टैब खोलें।
2. परिसर की सूची में प्रत्येक दस्तावेज़ दिखता है: प्राप्त या अभी शेष।
3. जोड़ने के लिए उसकी पंक्ति में **फ़ाइल जोड़ें** या **फ़ोटो लें** दबाएँ। आधार और अन्य कार्ड के **आगे** और **पीछे** दोनों भाग जोड़ें।
4. मूल प्रति देखने के बाद **सत्यापित** करने के लिए **सही का निशान** दबाएँ, या कारण सहित **अस्वीकार** के लिए **क्रॉस** दबाएँ।

किसने और कब जाँचा, यह दस्तावेज़ के साथ रखा जाता है।` } },
  },
  {
    slug: 'campus-admission-documents', module: 'core', pages: ['core.branches'], order: 60,
    title: 'Choose the documents each campus asks for',
    summary: 'Needed to admit, can come later, or not asked.',
    body: `1. Open **Administration › Campuses** and edit the campus.
2. Under **Documents at admission**, set each document to **Not asked**, **Can come later** or **Needed to admit**.
3. Save.

A document **Needed to admit** keeps the Admit button off until it is added. The others show as pending on the student's Documents tab.`,
    translations: { hi: {
      title: 'प्रत्येक परिसर द्वारा माँगे जाने वाले दस्तावेज़ चुनें',
      summary: 'प्रवेश के लिए आवश्यक, बाद में दिया जा सकता है, या नहीं माँगा।',
      body: `1. **प्रशासन › परिसर** खोलें और परिसर संपादित करें।
2. **प्रवेश के समय दस्तावेज़** में प्रत्येक दस्तावेज़ को **नहीं माँगा**, **बाद में** या **प्रवेश के लिए आवश्यक** पर सेट करें।
3. सहेजें।

**प्रवेश के लिए आवश्यक** दस्तावेज़ जुड़ने तक प्रवेश बटन बंद रहता है। शेष विद्यार्थी के दस्तावेज़ टैब में लंबित दिखते हैं।` } },
  },
  {
    slug: 'names-in-hindi', module: 'core', pages: ['core.local-names', 'core.settings', 'students.admit'], order: 70,
    title: 'Keep names in Hindi',
    summary: 'Type the name as it sounds in English letters — it turns into Hindi.',
    body: `1. In **Administration › Settings**, tick **Hindi** under **Also keep names in**. Forms then show a second box beside each name.
2. In the **Name in हिन्दी** box, type the name as it sounds: **uday** becomes **उदय** when you press space. Or press **Use …** under the box to take the English name written in Hindi.
3. For many names at once, use **Administration › Names in other languages**.

Hindi names print on documents whose print template is set to Hindi.`,
    translations: { hi: {
      title: 'नाम हिन्दी में भी रखें',
      summary: 'नाम अंग्रेज़ी अक्षरों में वैसा लिखें जैसा बोला जाता है — वह हिन्दी में बदल जाता है।',
      body: `1. **प्रशासन › सेटिंग्स** में **नाम इन भाषाओं में भी रखें** के अंतर्गत **हिन्दी** चुनें। तब फ़ॉर्म में प्रत्येक नाम के पास दूसरा बॉक्स दिखता है।
2. **हिन्दी में नाम** बॉक्स में नाम वैसा लिखें जैसा बोला जाता है: स्पेस दबाने पर **uday** **उदय** बन जाता है। या बॉक्स के नीचे **… रखें** दबाकर अंग्रेज़ी नाम का हिन्दी रूप लें।
3. एक साथ कई नामों के लिए **प्रशासन › नाम अन्य भाषाओं में** का उपयोग करें।

हिन्दी नाम उन दस्तावेज़ों पर प्रिंट होते हैं जिनका प्रिंट टेम्पलेट हिन्दी पर सेट है।` } },
  },
  {
    slug: 'admit-online-applicant', module: 'admissions', pages: ['admissions.applications'], order: 80,
    title: 'Admit a child who applied online',
    summary: 'Offer a seat, then admit into a section.',
    body: `1. Open **Admissions › Applications** and the child's application.
2. Move it on as you decide (shortlist, offer a seat). The family can accept the offer from the online page.
3. When the seat is offered or accepted, press **Admit**, pick the **section**, and confirm.

Everything the family filled — details, Hindi names, TC details, health and documents — goes to the new student. If the TC differs from the child's details, you are asked why.`,
    translations: { hi: {
      title: 'ऑनलाइन आवेदन करने वाले बच्चे को प्रवेश दें',
      summary: 'सीट प्रस्तावित करें, फिर अनुभाग में प्रवेश दें।',
      body: `1. **प्रवेश › आवेदन** में बच्चे का आवेदन खोलें।
2. निर्णय के अनुसार आगे बढ़ाएँ (चयन सूची, सीट का प्रस्ताव)। परिवार ऑनलाइन पृष्ठ से प्रस्ताव स्वीकार कर सकता है।
3. सीट प्रस्तावित या स्वीकार होने पर **प्रवेश दें** दबाएँ, **अनुभाग** चुनें और पुष्टि करें।

परिवार द्वारा भरा सब कुछ — विवरण, हिन्दी नाम, टीसी विवरण, स्वास्थ्य और दस्तावेज़ — नए विद्यार्थी के अभिलेख में चला जाता है। यदि टीसी बच्चे के विवरण से भिन्न है, तो कारण पूछा जाता है।` } },
  },
  {
    slug: 'books-uniform-list', module: 'academics', pages: ['academics.books-uniform'], order: 90,
    title: 'Publish the books & uniform list for a class',
    summary: 'Families see it in the app from the date you choose.',
    body: `1. Open **Academic setup › Books & uniform** and press **New list**.
2. Pick the **class** (and the campus, or all campuses).
3. Add books, notebooks, stationery, uniform and shoes — with code, quantity, price and a note. **Add from the store** brings in the school store's items with their code and price.
4. Write the instructions for families, then **Save**.
5. Add the publisher's book list (PDF) or a uniform photo under **Files**.
6. Set **Families see it from**, switch on **Published**, and save.

**Copy to other classes** starts the other classes' lists from this one.`,
    translations: { hi: {
      title: 'कक्षा की किताबों और वर्दी की सूची प्रकाशित करें',
      summary: 'परिवारों को यह ऐप में आपकी चुनी तिथि से दिखती है।',
      body: `1. **शैक्षणिक व्यवस्था › किताबें और वर्दी** खोलें और **नई सूची** दबाएँ।
2. **कक्षा** (और परिसर, या सभी परिसर) चुनें।
3. किताबें, कॉपियाँ, स्टेशनरी, वर्दी और जूते जोड़ें — कोड, मात्रा, मूल्य और टिप्पणी सहित। **स्टोर से जोड़ें** विद्यालय के स्टोर की वस्तुएँ उनके कोड और मूल्य सहित लाता है।
4. परिवारों के लिए निर्देश लिखें, फिर **सहेजें**।
5. **फ़ाइलें** में प्रकाशक की किताबों की सूची (पीडीएफ़) या वर्दी की फ़ोटो जोड़ें।
6. **परिवारों को इस तिथि से दिखे** चुनें, **प्रकाशित** चालू करें और सहेजें।

**अन्य कक्षाओं में कॉपी करें** से अन्य कक्षाओं की सूची इसी से शुरू होती है।` } },
  },
  {
    slug: 'recommend-shops', module: 'academics', pages: ['academics.books-uniform'], order: 100,
    title: 'Recommend shops for books and uniform',
    summary: 'Families get the shop’s address, a call button and a map link.',
    body: `1. Open the class's list in **Academic setup › Books & uniform**.
2. Under **Where to buy**, press **Add a shop** — or pick **A shop from another list**.
3. Fill in the name, phone, address, map link and a note (for example a discount).
4. Tick what the shop sells. With nothing ticked, it is for everything on the list.
5. Save.`,
    translations: { hi: {
      title: 'किताबों और वर्दी के लिए दुकानें सुझाएँ',
      summary: 'परिवारों को दुकान का पता, कॉल बटन और मानचित्र लिंक मिलता है।',
      body: `1. **शैक्षणिक व्यवस्था › किताबें और वर्दी** में कक्षा की सूची खोलें।
2. **कहाँ से खरीदें** में **दुकान जोड़ें** दबाएँ — या **किसी अन्य सूची की दुकान** चुनें।
3. नाम, फ़ोन, पता, मानचित्र लिंक और टिप्पणी (जैसे छूट) भरें।
4. दुकान जो बेचती है, उस पर निशान लगाएँ। कोई निशान न हो तो वह सूची की सभी वस्तुओं के लिए है।
5. सहेजें।` } },
  },
  {
    slug: 'parent-app-what-families-see', module: 'portal', pages: ['portal.settings'], order: 110,
    title: 'Choose what the parent app shows',
    summary: 'Each section: shown, parents only, or hidden — and which details of the child.',
    body: `1. Open **Parent & student app › App settings**.
2. Under **Sections in the app**, set each section to **Shown** or **Hidden**. With student sign-in on, you can also choose **Parents only**.
3. Under **Child's details and staff numbers**, tick the details the profile shows, and whether staff phone numbers show.

Changes apply at once. A hidden section cannot be opened even with a link.`,
    translations: { hi: {
      title: 'अभिभावक ऐप में क्या दिखे, यह चुनें',
      summary: 'प्रत्येक खंड: दिखाएँ, केवल माता-पिता, या छिपाएँ — और बच्चे का कौन-सा विवरण।',
      body: `1. **अभिभावक और विद्यार्थी ऐप › ऐप सेटिंग्स** खोलें।
2. **ऐप के खंड** में प्रत्येक खंड को **दिखाएँ** या **छिपाएँ** पर सेट करें। विद्यार्थी साइन-इन चालू होने पर **केवल माता-पिता** भी चुन सकते हैं।
3. **बच्चे का विवरण और कर्मचारियों के नंबर** में चुनें कि प्रोफ़ाइल में कौन-सा विवरण दिखे और कर्मचारियों के फ़ोन नंबर दिखें या नहीं।

बदलाव तुरंत लागू होते हैं। छिपा हुआ खंड लिंक से भी नहीं खुलता।` } },
  },
  {
    slug: 'share-parent-app', module: 'portal', pages: ['portal.settings'], order: 120,
    title: 'Share the parent app with families',
    summary: 'Switch it on, then share the link or print the QR notice.',
    body: `1. Open **Parent & student app › App settings** and tick **Parents and students can sign in to the app**.
2. Under **The app's address**, press **Copy link** to send it, or **Print a notice** for the QR poster.
3. Parents sign in with the mobile number on the student's record and a one-time code.`,
    translations: { hi: {
      title: 'अभिभावक ऐप परिवारों के साथ साझा करें',
      summary: 'इसे चालू करें, फिर लिंक साझा करें या क्यूआर सूचना प्रिंट करें।',
      body: `1. **अभिभावक और विद्यार्थी ऐप › ऐप सेटिंग्स** खोलें और **माता-पिता और विद्यार्थी ऐप में साइन इन कर सकते हैं** चुनें।
2. **ऐप का पता** में भेजने के लिए **लिंक कॉपी करें** दबाएँ, या क्यूआर पोस्टर के लिए **सूचना प्रिंट करें** दबाएँ।
3. माता-पिता विद्यार्थी के अभिलेख में दर्ज मोबाइल नंबर और एक बार उपयोग होने वाले कोड से साइन इन करते हैं।` } },
  },
  {
    slug: 'online-apply-code', module: 'admissions', pages: ['admissions.applications', 'core.settings'], order: 130,
    title: 'Online application: confirm families by mobile or email',
    summary: 'Choose whether the one-time code goes to the mobile, the email, or either.',
    body: `1. In **Settings › Admissions**, switch on **Ask for a one-time code before applying** if you want families confirmed first.
2. Set **Families confirm with a code sent to** to **Their mobile**, **Their email**, or **Mobile or email — they choose**.

The same choice is used on **Check my application**. Codes by email need the school's email set up.`,
    translations: { hi: {
      title: 'ऑनलाइन आवेदन: परिवारों की पुष्टि मोबाइल या ईमेल से',
      summary: 'चुनें कि कोड मोबाइल पर जाए, ईमेल पर, या दोनों में से किसी पर।',
      body: `1. यदि परिवारों की पहले पुष्टि करनी है, तो **सेटिंग्स › प्रवेश** में **आवेदन से पहले एक बार उपयोग होने वाला कोड माँगें** चालू करें।
2. **परिवार कोड से पुष्टि करें** को **उनका मोबाइल**, **उनका ईमेल** या **मोबाइल या ईमेल — वे स्वयं चुनें** पर सेट करें।

**मेरा आवेदन देखें** में भी यही विकल्प लागू होता है। ईमेल से कोड के लिए विद्यालय का ईमेल सेट होना आवश्यक है।` } },
  },
  {
    slug: 'hindi-names-required-campus', module: 'core', pages: ['core.branches'], order: 140,
    title: 'Make Hindi names required for a campus',
    summary: 'For a campus whose documents print in Hindi, such as a UP Board campus.',
    body: `1. Open **Administration › Campuses** and edit the campus.
2. Switch on **Names in हिन्दी needed at admission**.
3. Save.

Admitting a student to that campus then needs the student's and each parent's name in Hindi too. Other campuses are not affected.`,
    translations: { hi: {
      title: 'किसी परिसर के लिए हिन्दी नाम आवश्यक करें',
      summary: 'उस परिसर के लिए जिसके दस्तावेज़ हिन्दी में प्रिंट होते हैं, जैसे यूपी बोर्ड परिसर।',
      body: `1. **प्रशासन › परिसर** खोलें और परिसर संपादित करें।
2. **प्रवेश के समय हिन्दी में नाम आवश्यक** चालू करें।
3. सहेजें।

तब उस परिसर में प्रवेश के लिए विद्यार्थी और प्रत्येक अभिभावक का नाम हिन्दी में भी आवश्यक होगा। अन्य परिसरों पर इसका प्रभाव नहीं पड़ता।` } },
  },
  {
    slug: 'ask-schoolgiant-for-help', module: 'core', pages: [], order: 150,
    title: 'Ask SchoolGiant for help',
    summary: 'From your name at the top right › Help & support.',
    body: `1. Click your name at the top right and choose **Help & support**. Open it from the screen with the problem — that screen is sent along.
2. Pick what it is about and how urgent it is, write a few words, and describe what happened. Paste a screenshot if you can.
3. Press **Send to support**.

Our reply comes to the bell and by email. Answer from **My requests**; press **Yes, it’s solved** when it is sorted.`,
    translations: { hi: {
      title: 'SchoolGiant से सहायता माँगें',
      summary: 'ऊपर दाईं ओर अपने नाम › सहायता और समर्थन से।',
      body: `1. ऊपर दाईं ओर अपने नाम पर क्लिक करें और **सहायता और समर्थन** चुनें। इसे उसी पृष्ठ से खोलें जहाँ समस्या है — वह पृष्ठ भी साथ भेजा जाता है।
2. चुनें कि समस्या किस बारे में है और कितनी आवश्यक है, कुछ शब्द लिखें और बताएँ कि क्या हुआ। हो सके तो स्क्रीनशॉट पेस्ट करें।
3. **सहायता टीम को भेजें** दबाएँ।

हमारा उत्तर घंटी और ईमेल पर आता है। **मेरे अनुरोध** से उत्तर दें; समस्या हल होने पर **हाँ, हल हो गई** दबाएँ।` } },
  },
]
