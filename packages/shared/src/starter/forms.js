// Starter forms every institution gets (Administration › Form builder). They are ordinary
// forms: an institution edits them, publishes its own version, or archives them.

const n = (key, label, unit, extra = {}) => ({ key, label, type: 'NUMBER', unit, ...extra })
const pick = (key, label, options, extra = {}) => ({ key, label, type: 'SELECT', options, ...extra })
const yes = (key, label, extra = {}) => ({ key, label, type: 'YESNO', ...extra })
const BMI = { key: 'BMI', label: 'BMI', type: 'CALC', formula: 'WT / ((HT / 100) * (HT / 100))', decimals: 1, unit: 'kg/m²' }
const RATE = [{ label: 'Needs improvement', points: 1 }, { label: 'Satisfactory', points: 2 }, { label: 'Good', points: 3 }, { label: 'Excellent', points: 4 }]

export const STARTER_FORMS = [
  {
    code: 'HEALTH_CHECKUP', name: 'Annual health check-up', use: 'HEALTH',
    description: 'The yearly school health check: growth, vision, hearing, teeth and vaccinations.',
    definition: { sections: [
      { title: 'Growth', columns: 3, fields: [
        n('HT', 'Height', 'cm', { min: 40, max: 230 }),
        n('WT', 'Weight', 'kg', { min: 2, max: 200 }),
        BMI,
      ] },
      { title: 'Screening', columns: 2, fields: [
        pick('VISION', 'Vision', ['Normal', 'Needs glasses', 'Wears glasses', 'Refer to eye doctor']),
        pick('HEARING', 'Hearing', ['Normal', 'Refer']),
        pick('TEETH', 'Teeth', ['Healthy', 'Cavities', 'Refer to dentist']),
        yes('VACCINES_UP_TO_DATE', 'Vaccinations up to date'),
        { key: 'NOTES', label: 'Notes for parents', type: 'TEXTAREA' },
      ] },
    ] },
  },
  {
    code: 'PARENT_FEEDBACK', name: 'Parent feedback', use: 'SURVEY',
    description: 'A short term-end survey for parents.',
    definition: { sections: [
      { title: 'How are we doing?', columns: 1, fields: [
        { key: 'TEACHING', label: 'Quality of teaching', type: 'SCORE', options: RATE },
        { key: 'COMMUNICATION', label: 'Communication from the school', type: 'SCORE', options: RATE },
        { key: 'SAFETY', label: 'Safety and care of your child', type: 'SCORE', options: RATE },
        { key: 'FACILITIES', label: 'Facilities (classrooms, transport, canteen)', type: 'SCORE', options: RATE },
        { key: 'TOTAL', label: 'Overall score', type: 'TOTAL' },
        { key: 'COMMENTS', label: 'Anything you would like us to know?', type: 'TEXTAREA' },
      ] },
    ] },
  },
  {
    code: 'CLASS_OBSERVATION', name: 'Classroom observation', use: 'ASSESSMENT',
    description: 'A rubric for the principal or HOD observing a lesson.',
    definition: { sections: [
      { title: 'Lesson', columns: 2, fields: [
        { key: 'SUBJECT', label: 'Subject and topic', type: 'TEXT', required: true },
        { key: 'DATE', label: 'Date observed', type: 'DATE', required: true },
      ] },
      { title: 'Rubric', columns: 1, fields: [
        { key: 'PLANNING', label: 'Planning and objectives', type: 'SCORE', options: RATE },
        { key: 'ENGAGEMENT', label: 'Student engagement', type: 'SCORE', options: RATE },
        { key: 'CHECKING', label: 'Checking for understanding', type: 'SCORE', options: RATE },
        { key: 'CLASSROOM', label: 'Classroom management', type: 'SCORE', options: RATE },
        { key: 'TOTAL', label: 'Total', type: 'TOTAL' },
        { key: 'FEEDBACK', label: 'Feedback for the teacher', type: 'TEXTAREA' },
      ] },
    ] },
  },
]
