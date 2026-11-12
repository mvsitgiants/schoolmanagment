// Student content for the demo's Subject hub: a lesson page, two sub-topics and exam questions for any syllabus
// topic, written the way that subject is taught (maths, science, English, Hindi / Sanskrit, social science, computer,
// art and music, physical education, and the nursery classes). Used by demoStThomas.js (fillSubjectHub).

const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const ul = (xs) => `<ul>${xs.map((x) => `<li>${x}</li>`).join('')}</ul>`
const ol = (xs) => `<ol>${xs.map((x) => `<li>${x}</li>`).join('')}</ol>`
const h3 = (x) => `<h3>${x}</h3>`
const p = (x) => `<p>${x}</p>`

/** How a subject is taught: JUNIOR (Nursery – UKG), MATHS, SCIENCE, ENGLISH, HINDI, SOCIAL, COMPUTER, ARTS, PE, GENERAL. */
export function subjectKind(subject, grade) {
  if (grade <= 0) return 'JUNIOR'
  if (/math/i.test(subject)) return 'MATHS'
  if (/hindi|sanskrit/i.test(subject)) return 'HINDI'
  if (/english/i.test(subject)) return 'ENGLISH'
  if (/computer/i.test(subject)) return 'COMPUTER' // before science: "Computer Science"
  if (/science|physics|chemistry|biology|environment|evs/i.test(subject) && !/social/i.test(subject)) return 'SCIENCE'
  if (/social|history|geography|civics|economics/i.test(subject)) return 'SOCIAL'
  if (/art|craft|music/i.test(subject)) return 'ARTS'
  if (/physical/i.test(subject)) return 'PE'
  return 'GENERAL'
}

const exam = (question, answer, kind) => ({ question, answer, kind, use: 'EXAM' })

function maths({ t, r, unit }) {
  return {
    html: `<h2>${t}</h2>${p(`This lesson is part of <em>${unit}</em>. You will learn what <strong>${t}</strong> means, how to work out questions on it step by step, and where it is used in daily life.`)}`
      + h3('What you will learn') + ul([`The meaning of ${t}, with simple examples`, 'The rule or method, written in words before symbols', 'How to check your answer'])
      + h3('Worked example: how to solve') + ol(['Read the question twice. Write down what is given and what you have to find.', 'Pick the rule or method from this lesson that fits the question.', 'Work it out one step at a time, writing every step.', 'Check: put your answer back into the question and see if it fits.'])
      + h3('Try these') + ol([`Do the first three questions of the textbook exercise on ${t}.`, `Make up one question of your own on ${t} and solve it.`, 'Explain to someone at home how you solved one of them.'])
      + p('<strong>Remember:</strong> most mistakes come from skipping a step or a sign. Write every step, even when it feels easy.'),
    subTopics: [
      { name: `Understanding ${r}`, html: p(`Start here. Read the meaning of ${t} in the textbook and go through the solved examples. Draw a picture, number line or table if it helps you see the idea.`) + ul(['Write the meaning in your own words.', 'Copy any rule or formula into a box in your notebook.', 'Note one place where this is used outside school.']) },
      { name: `${r}: practice`, html: p('Practise until you can solve questions without looking at the example.') + ol(['Easy: the first half of the exercise.', 'Harder: the second half, and one word problem.', 'Check every answer, and redo the ones you got wrong.']) },
    ],
    questions: [
      exam(`State what “${r}” means and solve one simple question on it.`, 'Correct meaning, correct working and answer (2 marks).', 'SHORT'),
      exam(`Solve a word problem on “${r}”, showing every step.`, 'What is given, the method, each step of working, and the final answer with its unit (4 marks).', 'LONG'),
    ],
  }
}

function science({ t, r, unit, subject, grade }) {
  const senior = grade >= 11
  const young = grade <= 5
  const third = /physics|chemistry/i.test(subject) ? { name: `${r}: numericals`, html: p('Solve the numerical questions of this chapter in order.') + ol(['Write what is given, with units.', 'Write the formula you will use.', 'Put in the values and work it out.', 'Write the answer with its unit and check it makes sense.']) }
    : { name: `${r}: diagrams`, html: p(`Draw the main diagrams of ${t} neatly in pencil and label every part. Practise each diagram twice, once with the book open and once without.`) }
  return {
    html: `<h2>${t}</h2>${p(young
      ? `In this lesson of <em>${unit}</em> we look around us and learn about <strong>${t}</strong>. Talk about it at home too!`
      : `In this lesson of <em>${unit}</em> we find out about <strong>${t}</strong>: what it is, how we can observe it, and why it matters in everyday life.`)}`
      + h3('Key ideas') + ul(senior
        ? [`The definitions and laws of ${t}`, 'How each result is derived or explained', 'Where it is applied, with one real example']
        : [`What ${t} is, in simple words`, 'What we see when we observe or test it', 'Where we meet it at home, in nature or around us'])
      + h3('Let’s find out') + p(`Your teacher will show an activity on ${t} in class. Before each step, guess what will happen. After it, write:`)
      + ul(['<strong>What we did</strong>: the steps, in order', '<strong>What we saw</strong>: the observation', '<strong>What we learnt</strong>: the conclusion'])
      + h3('Words to know') + p('Find the new words of this lesson in your textbook and write each one with its meaning at the back of your notebook.')
      + p('<strong>Stay safe:</strong> do activities only with a teacher or an adult, and never taste or smell anything you do not know.'),
    subTopics: [
      { name: senior ? `${t}: concepts and definitions` : `What is ${t}?`, html: p(`Read this part of the chapter carefully. Underline each definition and write it in your own words. Give one example of ${t} from daily life.`) },
      senior ? third : { name: `${r}: activity and observation`, html: p('Write up the activity done in class:') + ul(['Aim: what we wanted to find out', 'What we used', 'What we did and what we saw', 'What we learnt']) },
    ],
    questions: [
      exam(`Define “${r}” and give one example.`, 'Correct definition with a suitable example (2 marks).', 'SHORT'),
      exam(`Explain “${r}” with a labelled diagram${senior ? ' or derivation' : ''}.`, 'Explanation of the key points, a neat labelled diagram, and a conclusion (5 marks).', 'LONG'),
    ],
  }
}

function english({ t, raw, unit }) {
  const bare = raw.replace(/^(grammar|writing|reading|literature)\s*:\s*/i, '')
  const name = bare.charAt(0).toUpperCase() + bare.slice(1)
  const n = esc(name)
  if (/^grammar/i.test(raw)) {
    return {
      html: `<h2>${t}</h2>${p(`Grammar helps us speak and write correctly. In this lesson of <em>${unit}</em> we learn about <strong>${n}</strong>.`)}`
        + h3('The rule') + p('Read the rule in your grammar book. Copy it into a box in your notebook with two examples of your own.')
        + h3('Spot it') + p(`Read one page of your reader and underline five places where ${n} is used.`)
        + h3('Practice') + ol(['Do the textbook exercise.', 'Write five sentences of your own.', 'Swap notebooks with a friend and check each other’s sentences.']),
      subTopics: [
        { name: `${name}: the rule`, html: p(`The rule of ${n}, with examples. Learn the rule and say the examples aloud.`) },
        { name: `${name}: practice`, html: p('Fill in the blanks, correct the errors and rewrite the sentences as shown in the exercise.') },
      ],
      questions: [
        exam(`Fill in the blanks using the correct form (${name}).`, 'One mark for each correct answer.', 'SHORT'),
        exam(`Rewrite the given paragraph correctly, paying attention to ${name}.`, 'Each correction counts (4 marks).', 'LONG'),
      ],
    }
  }
  if (/^writing|letter|composition|diary|notice/i.test(raw)) {
    return {
      html: `<h2>${t}</h2>${p(`In this lesson we learn to write <strong>${n}</strong> clearly and in the right format.`)}`
        + h3('The format') + p('Look at the sample in your textbook. Note how it begins, how it is set out, and how it ends.')
        + h3('How to write it') + ol(['Plan: note your main points in a few words.', 'Write: one idea in each paragraph, in simple sentences.', 'Check: spelling, punctuation and the format.'])
        + h3('Checklist') + ul(['Correct format', 'All the points asked for', 'Within the word limit', 'Neat handwriting']),
      subTopics: [
        { name: `${name}: format`, html: p('Copy the format into your notebook and label each part.') },
        { name: `${name}: write your own`, html: p('Write one on a topic given by your teacher, then check it against the checklist.') },
      ],
      questions: [
        exam(`Write on the topic given by your teacher, in the correct format (${name}, about 100 words).`, 'Format, content, expression and accuracy (5 marks).', 'LONG'),
      ],
    }
  }
  return {
    html: `<h2>${t}</h2>${p(`In this lesson of <em>${unit}</em> we read <strong>${n}</strong> and talk about what it means.`)}`
      + h3('Before you read') + p('Look at the title and the pictures. What do you think it is about? Write one line.')
      + h3('While you read') + ul(['Read once silently and once aloud.', 'Underline five new words.', 'Mark the line you like best.'])
      + h3('After you read') + ol(['Tell the main idea in three sentences.', 'Find the meanings of the new words and use each in a sentence.', 'Answer the textbook questions in your notebook.']),
    subTopics: [
      { name: `${name}: reading and meaning`, html: p('Read the text with your teacher. Note who, what, where and why for each part.') },
      { name: `${name}: word bank`, html: p('New words from the lesson, with their meanings and a sentence for each. Learn five words a day.') },
    ],
    questions: [
      exam(`Answer in 30–40 words: what is the main idea of “${name}”?`, 'Main idea with one supporting detail (2 marks).', 'SHORT'),
      exam(`Answer in 100–120 words: what lesson does “${name}” teach us?`, 'Theme, examples from the text and the student’s own view (5 marks).', 'LONG'),
    ],
  }
}

function hindi({ t, raw, subject }) {
  const sanskrit = /sanskrit/i.test(subject)
  return {
    html: `<h2>${t}</h2>${p(`इस पाठ में हम <strong>${t}</strong> के बारे में पढ़ेंगे। कक्षा से पहले एक बार पाठ पढ़ लें और कक्षा के बाद फिर से दोहराएँ।`)}`
      + h3('मुख्य बातें') + ul(['पाठ का मुख्य भाव अपने शब्दों में समझना', 'नए शब्द और उनके अर्थ', 'शुद्ध उच्चारण और सुंदर लेख'])
      + h3('अभ्यास') + ol(['पाठ को ज़ोर से पढ़ें।', 'पाँच नए शब्द चुनकर उनके अर्थ लिखें।', 'पाठ के प्रश्नों के उत्तर अपनी कॉपी में लिखें।'])
      + (sanskrit ? p('<strong>अनुवाद:</strong> पाठ के पाँच वाक्यों का हिन्दी में अनुवाद करें और उन्हें याद करें।') : p('<strong>याद रखें:</strong> उत्तर पूरे वाक्य में और साफ़ अक्षरों में लिखें।')),
    subTopics: [
      { name: `${raw} — परिचय`, html: p(`${t} का परिचय: पाठ ध्यान से पढ़ें और मुख्य बातें रेखांकित करें।`) },
      { name: `${raw} — अभ्यास`, html: p('पाठ के अंत में दिए गए अभ्यास कॉपी में करें। कठिन शब्दों को तीन-तीन बार लिखें।') },
    ],
    questions: [
      exam(`“${raw}” के मुख्य बिंदु लिखिए।`, 'सही मुख्य बिंदु (2 अंक)।', 'SHORT'),
      exam(`“${raw}” को उदाहरण सहित विस्तार से समझाइए।`, 'भाव, उदाहरण और निष्कर्ष (5 अंक)।', 'LONG'),
    ],
  }
}

function social({ t, r, unit }) {
  return {
    html: `<h2>${t}</h2>${p(`This lesson of <em>${unit}</em> is about <strong>${t}</strong>. Read it like a story: who, what, when, where and why.`)}`
      + h3('Key points') + ul(['The main events, places or ideas, in order', 'The people or groups involved', 'Why it matters to us today'])
      + h3('Map and timeline') + p(`Mark the places of this lesson on an outline map of India or the world. Make a simple timeline or flow chart of ${t} in your notebook.`)
      + h3('Think and discuss') + p('How is this connected to life in Uttar Pradesh or in your own town? Write two lines and share them in class.'),
    subTopics: [
      { name: `${r}: key facts`, html: p('Note the important facts (names, dates, places, terms) as short points. Learn them with a friend by asking each other.') },
      { name: `${r}: map and timeline work`, html: p('Use your atlas. Mark and label the places, then draw the timeline or flow chart from the lesson.') },
    ],
    questions: [
      exam(`Write any two important points about “${r}”.`, 'Two correct points (2 marks).', 'SHORT'),
      exam(`Describe “${r}” in detail, with examples.`, 'Background, main points, examples and conclusion (5 marks).', 'LONG'),
    ],
  }
}

function computer({ t, r }) {
  const safety = /safe|cyber|internet|email/i.test(t)
  return {
    html: `<h2>${t}</h2>${p(`In this lesson we learn about <strong>${t}</strong> and then try it ourselves in the computer lab.`)}`
      + h3('What it is') + p(`Read the lesson and write in two lines what ${t} is and what it is used for.`)
      + h3('Steps on the computer') + ol(['Watch your teacher show it on the projector.', 'Try it on your computer, one step at a time.', 'Save your work with your name and class.'])
      + h3('Tip') + p('Learn one keyboard shortcut from this lesson. It will save you time.')
      + (safety ? p('<strong>Stay safe:</strong> never share your password, and tell a teacher or parent if anything online worries you.') : ''),
    subTopics: [
      { name: `Learn: ${r}`, html: p('The idea in simple words, with a labelled picture of the screen.') },
      { name: `Lab practice: ${r}`, html: p('Do the lab task given by your teacher. Show your teacher your work before you close the program.') },
    ],
    questions: [
      exam(safety ? `Why is “${r}” important? Give one example.` : `What is “${r}”? Write one use.`, safety ? 'One reason with an example (2 marks).' : 'Correct meaning and one use (2 marks).', 'SHORT'),
      safety ? exam('Write four rules for staying safe on a computer and online.', 'Four correct rules (4 marks).', 'LONG') : exam(`Write the steps to do “${r}” on a computer.`, 'Steps in the correct order (4 marks).', 'LONG'),
    ],
  }
}

function arts({ t, r, subject }) {
  const music = /music/i.test(subject)
  return {
    html: `<h2>${t}</h2>${p(music
      ? `Today we enjoy <strong>${t}</strong>: we listen, clap, sing and play together.`
      : `Today we create something with <strong>${t}</strong>. There is no wrong answer in art: try your best and enjoy it.`)}`
      + h3(music ? 'What we will do' : 'What you need') + ul(music ? ['Listen to the teacher once', 'Clap or tap the rhythm', 'Sing or play it together'] : ['Drawing book or sheet', 'Pencil, eraser and colours', 'Any other material your teacher tells you'])
      + h3('Steps') + ol(music ? ['Warm up your voice or hands.', 'Learn one line at a time.', 'Put the lines together and perform as a group.'] : ['Look at the sample.', 'Draw or make the outline lightly.', 'Add colour and detail.', 'Write your name and date on your work.'])
      + p(music ? 'Practise at home for five minutes a day.' : 'Show your finished work to your family!'),
    subTopics: [
      { name: music ? 'Listen and learn' : 'Watch and learn', html: p(`Watch your teacher show ${t} step by step. Ask questions before you begin.`) },
      { name: music ? 'Perform together' : 'Make your own', html: p(music ? 'Perform with your group. Keep the rhythm together.' : 'Make your own piece. Try a new colour or idea of your own.') },
    ],
    questions: [{ question: `What did you enjoy most about “${r}”?`, answer: 'Any honest answer.', kind: 'SHORT', use: 'CLASS' }],
  }
}

function pe({ t, r }) {
  return {
    html: `<h2>${t}</h2>${p(`On the playground we learn and practise <strong>${t}</strong>. Wear sports shoes and bring a water bottle.`)}`
      + h3('Warm-up') + p('Jog for two rounds, then stretch your arms, legs and back for five minutes.')
      + h3('Skill steps') + ol(['Watch the teacher show the skill.', 'Try it slowly, in pairs.', 'Practise it at full speed in groups.', 'Play a short game using the skill.'])
      + h3('Stay safe') + ul(['Listen for the whistle', 'Keep a safe distance from others', 'Tell the teacher at once if you are hurt'])
      + p('Cool down with slow walking and deep breathing.'),
    subTopics: [
      { name: `${r}: skill drill`, html: p('Practise the drill shown in class five times. Focus on doing it correctly, not fast.') },
      { name: `${r}: game time`, html: p('Use the skill in a team game. Play fair and cheer for your team-mates.') },
    ],
    questions: [{ question: `Name two safety rules for “${r}”.`, answer: 'Any two correct safety rules.', kind: 'SHORT', use: 'CLASS' }],
  }
}

function junior({ t, r }) {
  return {
    html: `<h2>${t}</h2>${p(`Today we learn about <strong>${t}</strong> with songs, pictures and play.`)}`
      + h3('Let’s look') + p('Look at the pictures with your teacher. Say what you see.')
      + h3('Let’s do') + ul(['Sing the rhyme and do the actions', 'Colour, match or sort the pictures', 'Show and tell in class'])
      + h3('For parents') + p(`Spend five minutes with your child on ${t} at home. Point to things around the house and ask your child to name them. Praise every try.`),
    subTopics: [
      { name: `Look and say: ${r}`, html: p('Picture cards: name each one, then find it in the classroom.') },
      { name: `Play and do: ${r}`, html: p('A game or colouring sheet on today’s topic. Have fun!') },
    ],
    questions: [],
  }
}

function general({ t, r, unit }) {
  return {
    html: `<h2>${t}</h2>${p(`In this lesson of <em>${unit}</em> we learn about <strong>${t}</strong>.`)}`
      + h3('Key ideas') + ul([`The main idea of ${t}`, 'One example', 'A two-line summary in your notebook']),
    subTopics: [
      { name: `${r}: introduction`, html: p('Read the lesson and note the main idea.') },
      { name: `${r}: practice`, html: p('Do the exercise given by your teacher.') },
    ],
    questions: [exam(`Write a short note on “${r}”.`, 'Main idea with an example (3 marks).', 'SHORT')],
  }
}

const WRITERS = { MATHS: maths, SCIENCE: science, ENGLISH: english, HINDI: hindi, SOCIAL: social, COMPUTER: computer, ARTS: arts, PE: pe, JUNIOR: junior, GENERAL: general }

/**
 * The student content of a topic: `contentHtml`, two `subTopics` ({ name, contentHtml }) and `questions` to add to the
 * topic's own (exam questions, or a class question for activity subjects; none for the nursery classes).
 */
export function lessonFor({ topic, unit, subject, grade }) {
  const kind = subjectKind(subject, grade)
  const out = WRITERS[kind]({ t: esc(topic), r: topic, raw: topic, unit: esc(unit), subject, grade })
  return {
    kind, contentHtml: out.html,
    subTopics: out.subTopics.map((s) => ({ name: s.name, contentHtml: s.html })),
    questions: out.questions,
  }
}
