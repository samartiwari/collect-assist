// Tiny dictionary-based translations. English is the source of truth; the Hindi table
// must have every key (the type enforces it). Keep Hindi short and plain: officers read
// it on a small screen, outdoors, often with one hand.
import { useCallback } from 'react';
import type { Lang } from '../../shared/types';
import { istDate, istTimeLabel } from '../../shared/time';
import { useAuth } from './auth';

const en = {
  'app.name': 'CollectAssist',
  'app.skip': 'Skip to content',
  'app.tagline': 'Field collections for Company A',

  'nav.main': 'Main',
  'nav.today': 'Today',
  'nav.promises': 'Promises',
  'nav.sync': 'Sync',
  'nav.overview': 'Overview',
  'nav.import': 'Import',
  'nav.team': 'Team',
  'nav.activity': 'Activity',

  'role.officer': 'Field officer',
  'role.manager': 'Branch manager',
  'role.head': 'Head of collections',
  'branch.all': 'All branches',

  'menu.open': 'Account menu',
  'menu.signOut': 'Sign out',
  'menu.unsynced': '{n} updates have not reached the server yet. Sync first so nothing is lost.',
  'menu.unsyncedOne': '1 update has not reached the server yet. Sync first so nothing is lost.',
  'menu.syncFirst': 'Sync now',
  'menu.signOutAnyway': 'Sign out anyway',
  'menu.savedSession': 'Offline: using the sign-in saved on this phone',

  'offline.strip': "You're offline. Updates are saved on this phone and sync later.",
  'lang.label': 'Language',

  'status.synced': 'Synced',
  'status.syncing': 'Syncing',
  'status.waiting': '{n} waiting',
  'status.offline': 'Offline',
  'status.aria': '{state}. Open sync centre.',

  'demo.pill': 'Demo {time}',
  'demo.pillOff': 'Demo clock',
  'demo.title': 'Demo clock',
  'demo.help': 'Move the app clock to test the 8 am – 7 pm contact window. All times are IST.',
  'demo.time': 'Time (IST)',
  'demo.set': 'Set time',
  'demo.reset': 'Use real time',
  'demo.active': 'Simulated time: {time}',
  'demo.real': 'Using real time: {time}',
  'demo.failed': 'Could not change the clock: {msg}',
  'demo.invalid': 'Enter a time like 11:00',
  'demo.changed': 'Clock set to {time} IST',
  'demo.resetDone': 'Back to real time',

  'state.loading': 'Loading…',
  'state.retry': 'Try again',
  'state.errorTitle': 'Something went wrong',
  'state.offlineTitle': 'No signal',
  'state.offlineBody': 'This needs a connection. It will work again when you have signal.',

  'window.open': 'Contact allowed until {time} · {left} left',
  'window.closing': 'Contact closes at {time} · only {left} left',
  'window.closed': 'Contact closed (RBI hours 8 am–7 pm). Opens {time}. Calls and visits are blocked.',
  'window.tomorrow': '{time} tomorrow',
  'dur.hm': '{h}h {m}m',
  'dur.m': '{m}m',

  'today.greetMorning': 'Good morning, {name}',
  'today.greetAfternoon': 'Good afternoon, {name}',
  'today.greetEvening': 'Good evening, {name}',
  'today.toContact': 'to contact',
  'today.atRisk': 'at risk',
  'today.promisesDue': 'promises due today',
  'today.section': 'Today',
  'today.later': 'Later ({n})',
  'today.done': 'Done today ({n})',
  'today.emptyTitle': 'No overdue loans assigned to you today',
  'today.emptyBody': 'Your manager uploads the overdue list each morning. Check again later.',
  'today.allDoneTitle': 'Every loan on your list has an outcome',
  'today.allDoneBody': 'Good work. Anything new will appear here after the next import.',
  'today.offline': 'Offline — showing the list saved at {time}.',
  'today.unreachable': "Can't reach the server — showing the list saved at {time}.",
  'today.waiting': '{n} updates waiting to sync.',
  'today.waitingOne': '1 update waiting to sync.',
  'today.oldList': 'This list is from {date}.',
  'today.updated': 'Updated {time}',
  'today.refresh': 'Refresh list',
  'today.loadError': 'Could not load your list',
  'today.noCache': "No list saved on this phone yet. Connect once to download today's list.",

  'risk.high': 'High',
  'risk.mid': 'Medium',
  'risk.low': 'Low',
  'risk.aria': 'Risk {level}, score {n} out of 100',
  'risk.none': 'Not scored',

  'card.dpd': '{n} DPD',
  'card.outstanding': '{amount} outstanding',
  'card.moreReasons': '+{n} more',
  'card.moreReasonOne': '+1 more',
  'card.pinned': 'Pinned by {name}: {reason}',
  'card.promise': 'Promise {amount} · {date}',
  'card.promiseToday': 'Promise {amount} · due today',
  'card.promiseBroken': 'Promise {amount} broken · {date}',
  'card.lowConfidence': 'Rough score — limited history',
  'card.call': 'Call',
  'card.map': 'Map',
  'card.log': 'Log',
  'card.open': 'Open details for {name}',
  'card.doneAt': '{outcome} · {time}',

  'call.blocked': 'Calls are blocked until {time} (RBI hours)',
  'call.prompt': 'Spoke to {name}? Log the outcome.',
  'call.promptAction': 'Log',
  'call.noPhone': 'No phone number on file',

  'kind.call': 'Call',
  'kind.visit': 'Visit',

  'outcome.paid': 'Paid',
  'outcome.promise': 'Promise to pay',
  'outcome.not_reachable': 'Not reachable',
  'outcome.dispute': 'Dispute',
  'outcome.blocked': 'Call blocked',

  'sheet.title': 'Log outcome',
  'sheet.close': 'Close',
  'sheet.how': 'Contact type',
  'sheet.outcome': 'What happened?',
  'sheet.amountPaid': 'Amount paid',
  'sheet.amountPromised': 'Amount promised',
  'sheet.amountHint': 'EMI {emi} · Outstanding {out}',
  'sheet.when': 'Will pay by',
  'sheet.tomorrow': 'Tomorrow',
  'sheet.in3': 'In 3 days',
  'sheet.in7': 'In 7 days',
  'sheet.otherDate': 'Other date',
  'sheet.noteOptional': 'Note (optional)',
  'sheet.noteRequired': 'What is the dispute about?',
  'sheet.notePlaceholder': 'Short note',
  'sheet.chars': '{n}/200',
  'sheet.save': 'Save',
  'sheet.saving': 'Saving…',
  'sheet.pick': 'Pick what happened',
  'sheet.closed': 'Contact closed',
  'sheet.locating': 'Getting location…',
  'sheet.located': 'Location: ±{m} m',
  'sheet.locationOff': 'Location off — will save without it',

  'err.amount': 'Enter an amount',
  'err.amountZero': 'Amount must be more than ₹0',
  'err.amountMax': "Can't be more than the outstanding {max}",
  'err.date': 'Pick a date between today and {max}',
  'err.noteRequired': 'Add a short note about the dispute',
  'err.noteLong': 'Keep the note under 200 characters',

  'toast.saved': 'Saved',
  'toast.savedOffline': 'Saved offline — will sync when you have signal',
  'toast.saveFailed': 'Could not save on this phone. Please try again.',

  'detail.back': 'Back',
  'detail.outstanding': 'Outstanding',
  'detail.emi': 'EMI',
  'detail.dpd': 'Days past due',
  'detail.lastPayment': 'Last payment',
  'detail.never': 'None on record',
  'detail.priority': 'Priority',
  'detail.roll': '{pct} chance of rolling into 31–60 DPD',
  'detail.why': 'Why this score',
  'detail.raises': 'Raises risk',
  'detail.lowers': 'Lowers risk',
  'detail.advisory': 'This score is advisory — your manager can reorder your list.',
  'detail.advisoryManager': 'This score is advisory — pin a loan to move it up an officer’s list.',
  'detail.model': 'Model {v} · scored {time}',
  'detail.noScore': 'Not scored yet. It will be scored after the next import.',
  'detail.logOutcome': 'Log outcome',
  'detail.promises': 'Promises',
  'detail.noPromises': 'No promises yet',
  'detail.history': 'Contact history',
  'detail.noHistory': 'No calls or visits logged yet',
  'detail.waiting': 'Waiting to sync',
  'detail.offlineBadge': 'Logged offline',
  'detail.blocked': 'Blocked: outside 8 am–7 pm',
  'detail.distance': '{d} from address',
  'detail.by': 'by {name}',
  'detail.offline': 'Offline — showing the details saved on this phone. History and reminders load when you have signal.',
  'detail.notFound': 'This loan is not on your list',
  'detail.officer': 'Officer: {name}',
  'detail.unassigned': 'Not assigned',
  'detail.contact': 'Contact',
  'detail.phone': 'Phone',
  'detail.address': 'Address',
  'detail.loadError': 'Could not load this loan',

  'rem.title': 'Reminder message',
  'rem.simulated': 'Messages are simulated in this demo — nothing reaches the borrower.',
  'rem.template': 'Approved template',
  'rem.prepare': 'Prepare message',
  'rem.preparing': 'Preparing…',
  'rem.message': 'Message (you can edit it)',
  'rem.blockedWords': 'Remove these words before sending: {words}',
  'rem.send': 'Send',
  'rem.sending': 'Sending…',
  'rem.discard': 'Discard',
  'rem.sent': 'Sent (simulated)',
  'rem.blocked': 'Blocked: {reason}',
  'rem.past': 'Messages',
  'rem.none': 'No messages sent yet',
  'rem.noTemplates': 'No approved templates are available',
  'rem.closed': 'Outside 8 am–7 pm, messages are blocked.',
  'rem.loadFailed': 'Could not load templates',
  'rem.failed': 'Could not send: {msg}',

  'prom.title': 'Promises',
  'prom.subtitle': 'Borrowers who promised to pay',
  'prom.due_today': 'Due today',
  'prom.upcoming': 'Upcoming',
  'prom.broken': 'Broken',
  'prom.kept': 'Kept',
  'prom.daysLate': '{n} days late',
  'prom.dayLate': '1 day late',
  'prom.empty.due_today': 'No promises due today',
  'prom.empty.upcoming': 'No upcoming promises',
  'prom.empty.broken': 'No broken promises',
  'prom.empty.kept': 'No kept promises yet',
  'prom.loadError': 'Could not load promises',
  'prom.offline': 'Offline — showing promises saved at {time}.',

  'rel.today': 'Today',
  'rel.tomorrow': 'Tomorrow',
  'rel.inDays': 'In {n} days',

  'sync.title': 'Sync',
  'sync.explain': 'Updates are saved on your phone first and sent when you have signal. Nothing is lost if the signal drops.',
  'sync.allSent': 'Online — everything is sent',
  'sync.pending': '{n} updates waiting to send',
  'sync.pendingOne': '1 update waiting to send',
  'sync.offline': 'Offline — {n} updates waiting',
  'sync.offlineOne': 'Offline — 1 update waiting',
  'sync.offlineNone': 'Offline — nothing waiting',
  'sync.syncing': 'Sending updates…',
  'sync.last': 'Last sync {time}',
  'sync.never': 'Nothing sent from this phone yet',
  'sync.now': 'Sync now',
  'sync.noSignal': 'No signal. Updates will send by themselves when you are back online.',
  'sync.waitingTitle': 'Waiting to send ({n})',
  'sync.waitingEmpty': 'Nothing waiting',
  'sync.recentTitle': 'Recent',
  'sync.recentEmpty': 'No updates sent yet',
  'sync.waiting': 'Waiting',
  'sync.accepted': 'Synced',
  'sync.duplicate': 'Already synced',
  'sync.blocked': 'Blocked: outside 8 am–7 pm',
  'sync.rejected': 'Not saved',
  'sync.error': 'Last try failed: {msg}',

  'login.title': 'Sign in',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.show': 'Show',
  'login.hide': 'Hide',
  'login.submit': 'Sign in',
  'login.busy': 'Signing in…',
  'login.demo': 'Demo accounts',
  'login.demoHint': 'Tap one to fill the form. Password for all: Demo@1234',
  'login.errEmail': 'Enter a valid email address',
  'login.errPassword': 'Enter your password',
  'login.offline': "You're offline. Connect to the internet to sign in.",
  'login.footer': 'Borrower contact is allowed only 8 am – 7 pm IST. Every attempt is recorded.',
} satisfies Record<string, string>;

export type MsgKey = keyof typeof en;

const hi: Record<MsgKey, string> = {
  'app.name': 'CollectAssist',
  'app.skip': 'मुख्य भाग पर जाएँ',
  'app.tagline': 'Company A के लिए फ़ील्ड कलेक्शन',

  'nav.main': 'मुख्य',
  'nav.today': 'आज',
  'nav.promises': 'वादे',
  'nav.sync': 'सिंक',
  'nav.overview': 'सारांश',
  'nav.import': 'इम्पोर्ट',
  'nav.team': 'टीम',
  'nav.activity': 'गतिविधि',

  'role.officer': 'फ़ील्ड अधिकारी',
  'role.manager': 'ब्रांच मैनेजर',
  'role.head': 'कलेक्शन प्रमुख',
  'branch.all': 'सभी ब्रांच',

  'menu.open': 'अकाउंट मेन्यू',
  'menu.signOut': 'साइन आउट',
  'menu.unsynced': '{n} अपडेट अभी सर्वर तक नहीं पहुँचे। पहले सिंक करें ताकि कुछ न खोए।',
  'menu.unsyncedOne': '1 अपडेट अभी सर्वर तक नहीं पहुँचा। पहले सिंक करें ताकि कुछ न खोए।',
  'menu.syncFirst': 'अभी सिंक करें',
  'menu.signOutAnyway': 'फिर भी साइन आउट',
  'menu.savedSession': 'ऑफ़लाइन: फ़ोन में सेव साइन-इन से चल रहा है',

  'offline.strip': 'आप ऑफ़लाइन हैं। अपडेट फ़ोन में सेव हैं, बाद में सिंक होंगे।',
  'lang.label': 'भाषा',

  'status.synced': 'सिंक है',
  'status.syncing': 'सिंक हो रहा है',
  'status.waiting': '{n} बाकी',
  'status.offline': 'ऑफ़लाइन',
  'status.aria': '{state}। सिंक पेज खोलें।',

  'demo.pill': 'डेमो {time}',
  'demo.pillOff': 'डेमो घड़ी',
  'demo.title': 'डेमो घड़ी',
  'demo.help': 'सुबह 8 – शाम 7 की संपर्क सीमा जाँचने के लिए ऐप का समय बदलें। सभी समय IST में हैं।',
  'demo.time': 'समय (IST)',
  'demo.set': 'समय सेट करें',
  'demo.reset': 'असली समय',
  'demo.active': 'डेमो समय: {time}',
  'demo.real': 'असली समय: {time}',
  'demo.failed': 'घड़ी नहीं बदली: {msg}',
  'demo.invalid': '11:00 जैसा समय लिखें',
  'demo.changed': 'समय {time} IST किया गया',
  'demo.resetDone': 'असली समय चालू',

  'state.loading': 'लोड हो रहा है…',
  'state.retry': 'फिर कोशिश करें',
  'state.errorTitle': 'कुछ गड़बड़ हुई',
  'state.offlineTitle': 'नेटवर्क नहीं है',
  'state.offlineBody': 'इसके लिए नेटवर्क चाहिए। नेटवर्क आने पर यह फिर चलेगा।',

  'window.open': '{time} तक संपर्क कर सकते हैं · {left} बाकी',
  'window.closing': 'संपर्क {time} पर बंद होगा · सिर्फ़ {left} बाकी',
  'window.closed': 'संपर्क बंद है (RBI समय सुबह 8 – शाम 7)। {time} पर खुलेगा। कॉल और विज़िट अभी नहीं हो सकते।',
  'window.tomorrow': 'कल {time}',
  'dur.hm': '{h} घं {m} मि',
  'dur.m': '{m} मि',

  'today.greetMorning': 'नमस्ते, {name}',
  'today.greetAfternoon': 'नमस्ते, {name}',
  'today.greetEvening': 'नमस्ते, {name}',
  'today.toContact': 'संपर्क बाकी',
  'today.atRisk': 'जोखिम में',
  'today.promisesDue': 'आज के वादे',
  'today.section': 'आज की सूची',
  'today.later': 'बाद में ({n})',
  'today.done': 'आज पूरे ({n})',
  'today.emptyTitle': 'आज आपके नाम कोई बकाया लोन नहीं है',
  'today.emptyBody': 'मैनेजर हर सुबह बकाया सूची अपलोड करते हैं। बाद में फिर देखें।',
  'today.allDoneTitle': 'सूची के हर लोन का नतीजा दर्ज है',
  'today.allDoneBody': 'बढ़िया। अगली सूची आने पर नए लोन यहाँ दिखेंगे।',
  'today.offline': 'ऑफ़लाइन — {time} पर सेव की गई सूची दिख रही है।',
  'today.unreachable': 'सर्वर से संपर्क नहीं — {time} पर सेव की गई सूची दिख रही है।',
  'today.waiting': '{n} अपडेट सिंक होने बाकी।',
  'today.waitingOne': '1 अपडेट सिंक होना बाकी।',
  'today.oldList': 'यह सूची {date} की है।',
  'today.updated': '{time} पर अपडेट',
  'today.refresh': 'सूची रीफ़्रेश करें',
  'today.loadError': 'आपकी सूची लोड नहीं हुई',
  'today.noCache': 'इस फ़ोन में अभी कोई सूची सेव नहीं है। आज की सूची के लिए एक बार नेटवर्क से जुड़ें।',

  'risk.high': 'ज़्यादा',
  'risk.mid': 'मध्यम',
  'risk.low': 'कम',
  'risk.aria': 'जोखिम {level}, स्कोर 100 में {n}',
  'risk.none': 'स्कोर नहीं',

  'card.dpd': '{n} दिन बकाया',
  'card.outstanding': '{amount} बकाया',
  'card.moreReasons': '+{n} और',
  'card.moreReasonOne': '+1 और',
  'card.pinned': '{name} ने ऊपर रखा: {reason}',
  'card.promise': 'वादा {amount} · {date}',
  'card.promiseToday': 'वादा {amount} · आज',
  'card.promiseBroken': 'वादा {amount} टूटा · {date}',
  'card.lowConfidence': 'अनुमानित स्कोर — कम जानकारी',
  'card.call': 'कॉल करें',
  'card.map': 'नक्शा',
  'card.log': 'दर्ज करें',
  'card.open': '{name} की जानकारी खोलें',
  'card.doneAt': '{outcome} · {time}',

  'call.blocked': '{time} तक कॉल बंद हैं (RBI समय)',
  'call.prompt': '{name} से बात हुई? नतीजा दर्ज करें।',
  'call.promptAction': 'दर्ज करें',
  'call.noPhone': 'फ़ोन नंबर नहीं है',

  'kind.call': 'कॉल',
  'kind.visit': 'विज़िट',

  'outcome.paid': 'भुगतान हुआ',
  'outcome.promise': 'वादा',
  'outcome.not_reachable': 'संपर्क नहीं हुआ',
  'outcome.dispute': 'विवाद',
  'outcome.blocked': 'कॉल रोकी गई',

  'sheet.title': 'नतीजा दर्ज करें',
  'sheet.close': 'बंद करें',
  'sheet.how': 'संपर्क का तरीका',
  'sheet.outcome': 'क्या हुआ?',
  'sheet.amountPaid': 'जमा राशि',
  'sheet.amountPromised': 'वादे की राशि',
  'sheet.amountHint': 'EMI {emi} · बकाया {out}',
  'sheet.when': 'कब तक देंगे',
  'sheet.tomorrow': 'कल',
  'sheet.in3': '3 दिन में',
  'sheet.in7': '7 दिन में',
  'sheet.otherDate': 'दूसरी तारीख',
  'sheet.noteOptional': 'नोट (ज़रूरी नहीं)',
  'sheet.noteRequired': 'विवाद किस बात पर है?',
  'sheet.notePlaceholder': 'छोटा नोट',
  'sheet.chars': '{n}/200',
  'sheet.save': 'सेव करें',
  'sheet.saving': 'सेव हो रहा है…',
  'sheet.pick': 'क्या हुआ, चुनें',
  'sheet.closed': 'संपर्क बंद है',
  'sheet.locating': 'लोकेशन ली जा रही है…',
  'sheet.located': 'लोकेशन: ±{m} मी',
  'sheet.locationOff': 'लोकेशन बंद — इसके बिना सेव होगा',

  'err.amount': 'राशि लिखें',
  'err.amountZero': 'राशि ₹0 से ज़्यादा होनी चाहिए',
  'err.amountMax': 'बकाया {max} से ज़्यादा नहीं हो सकती',
  'err.date': 'आज से {max} तक की तारीख चुनें',
  'err.noteRequired': 'विवाद के बारे में छोटा नोट लिखें',
  'err.noteLong': 'नोट 200 अक्षरों से छोटा रखें',

  'toast.saved': 'सेव हो गया',
  'toast.savedOffline': 'ऑफ़लाइन सेव — नेटवर्क आने पर सिंक होगा',
  'toast.saveFailed': 'फ़ोन में सेव नहीं हुआ। फिर कोशिश करें।',

  'detail.back': 'वापस',
  'detail.outstanding': 'बकाया राशि',
  'detail.emi': 'EMI',
  'detail.dpd': 'बकाया दिन',
  'detail.lastPayment': 'पिछला भुगतान',
  'detail.never': 'कोई रिकॉर्ड नहीं',
  'detail.priority': 'प्राथमिकता',
  'detail.roll': '31–60 DPD में जाने की संभावना {pct}',
  'detail.why': 'यह स्कोर क्यों',
  'detail.raises': 'जोखिम बढ़ाता है',
  'detail.lowers': 'जोखिम घटाता है',
  'detail.advisory': 'यह स्कोर सिर्फ़ सलाह है — मैनेजर आपकी सूची का क्रम बदल सकते हैं।',
  'detail.advisoryManager': 'यह स्कोर सिर्फ़ सलाह है — लोन को ऊपर लाने के लिए उसे पिन करें।',
  'detail.model': 'मॉडल {v} · स्कोर {time}',
  'detail.noScore': 'अभी स्कोर नहीं है। अगले इम्पोर्ट के बाद बनेगा।',
  'detail.logOutcome': 'नतीजा दर्ज करें',
  'detail.promises': 'वादे',
  'detail.noPromises': 'अभी कोई वादा नहीं',
  'detail.history': 'संपर्क का इतिहास',
  'detail.noHistory': 'अभी कोई कॉल या विज़िट दर्ज नहीं',
  'detail.waiting': 'सिंक बाकी',
  'detail.offlineBadge': 'ऑफ़लाइन दर्ज',
  'detail.blocked': 'रोका गया: सुबह 8 – शाम 7 के बाहर',
  'detail.distance': 'पते से {d}',
  'detail.by': '{name} द्वारा',
  'detail.offline': 'ऑफ़लाइन — फ़ोन में सेव जानकारी दिख रही है। इतिहास और मैसेज नेटवर्क आने पर दिखेंगे।',
  'detail.notFound': 'यह लोन आपकी सूची में नहीं है',
  'detail.officer': 'अधिकारी: {name}',
  'detail.unassigned': 'किसी को नहीं सौंपा',
  'detail.contact': 'संपर्क',
  'detail.phone': 'फ़ोन',
  'detail.address': 'पता',
  'detail.loadError': 'यह लोन लोड नहीं हुआ',

  'rem.title': 'रिमाइंडर मैसेज',
  'rem.simulated': 'यह डेमो है — मैसेज असल में ग्राहक तक नहीं जाते।',
  'rem.template': 'मंज़ूर टेम्पलेट',
  'rem.prepare': 'मैसेज तैयार करें',
  'rem.preparing': 'तैयार हो रहा है…',
  'rem.message': 'मैसेज (बदल सकते हैं)',
  'rem.blockedWords': 'भेजने से पहले ये शब्द हटाएँ: {words}',
  'rem.send': 'भेजें',
  'rem.sending': 'भेजा जा रहा है…',
  'rem.discard': 'रद्द करें',
  'rem.sent': 'भेजा गया (डेमो)',
  'rem.blocked': 'रोका गया: {reason}',
  'rem.past': 'मैसेज',
  'rem.none': 'अभी कोई मैसेज नहीं भेजा',
  'rem.noTemplates': 'कोई मंज़ूर टेम्पलेट नहीं है',
  'rem.closed': 'सुबह 8 – शाम 7 के बाहर मैसेज रोक दिए जाते हैं।',
  'rem.loadFailed': 'टेम्पलेट लोड नहीं हुए',
  'rem.failed': 'नहीं भेजा जा सका: {msg}',

  'prom.title': 'वादे',
  'prom.subtitle': 'जिन्होंने भुगतान का वादा किया',
  'prom.due_today': 'आज',
  'prom.upcoming': 'आने वाले',
  'prom.broken': 'टूटे',
  'prom.kept': 'पूरे हुए',
  'prom.daysLate': '{n} दिन देर',
  'prom.dayLate': '1 दिन देर',
  'prom.empty.due_today': 'आज कोई वादा नहीं',
  'prom.empty.upcoming': 'आगे कोई वादा नहीं',
  'prom.empty.broken': 'कोई टूटा वादा नहीं',
  'prom.empty.kept': 'अभी कोई पूरा हुआ वादा नहीं',
  'prom.loadError': 'वादे लोड नहीं हुए',
  'prom.offline': 'ऑफ़लाइन — {time} पर सेव किए गए वादे दिख रहे हैं।',

  'rel.today': 'आज',
  'rel.tomorrow': 'कल',
  'rel.inDays': '{n} दिन में',

  'sync.title': 'सिंक',
  'sync.explain': 'अपडेट पहले आपके फ़ोन में सेव होते हैं और नेटवर्क मिलने पर भेजे जाते हैं। नेटवर्क जाने पर भी कुछ नहीं खोता।',
  'sync.allSent': 'ऑनलाइन — सब भेज दिया गया',
  'sync.pending': '{n} अपडेट भेजने बाकी',
  'sync.pendingOne': '1 अपडेट भेजना बाकी',
  'sync.offline': 'ऑफ़लाइन — {n} अपडेट बाकी',
  'sync.offlineOne': 'ऑफ़लाइन — 1 अपडेट बाकी',
  'sync.offlineNone': 'ऑफ़लाइन — कुछ बाकी नहीं',
  'sync.syncing': 'अपडेट भेजे जा रहे हैं…',
  'sync.last': 'आखिरी सिंक {time}',
  'sync.never': 'इस फ़ोन से अभी कुछ नहीं भेजा गया',
  'sync.now': 'अभी सिंक करें',
  'sync.noSignal': 'नेटवर्क नहीं है। नेटवर्क आते ही अपडेट अपने-आप चले जाएँगे।',
  'sync.waitingTitle': 'भेजने बाकी ({n})',
  'sync.waitingEmpty': 'कुछ बाकी नहीं',
  'sync.recentTitle': 'हाल के',
  'sync.recentEmpty': 'अभी कुछ नहीं भेजा',
  'sync.waiting': 'बाकी',
  'sync.accepted': 'सिंक हुआ',
  'sync.duplicate': 'पहले ही सिंक',
  'sync.blocked': 'रोका गया: सुबह 8 – शाम 7 के बाहर',
  'sync.rejected': 'सेव नहीं हुआ',
  'sync.error': 'पिछली कोशिश नहीं हुई: {msg}',

  'login.title': 'साइन इन',
  'login.email': 'ईमेल',
  'login.password': 'पासवर्ड',
  'login.show': 'दिखाएँ',
  'login.hide': 'छिपाएँ',
  'login.submit': 'साइन इन करें',
  'login.busy': 'साइन इन हो रहा है…',
  'login.demo': 'डेमो अकाउंट',
  'login.demoHint': 'फ़ॉर्म भरने के लिए किसी पर टैप करें। सबका पासवर्ड: Demo@1234',
  'login.errEmail': 'सही ईमेल लिखें',
  'login.errPassword': 'पासवर्ड लिखें',
  'login.offline': 'आप ऑफ़लाइन हैं। साइन इन के लिए इंटरनेट चालू करें।',
  'login.footer': 'ग्राहक से संपर्क सिर्फ़ सुबह 8 – शाम 7 (IST) के बीच। हर कोशिश दर्ज होती है।',
};

const dicts: Record<Lang, Record<MsgKey, string>> = { en, hi };

export type Vars = Record<string, string | number>;
export type TFn = (key: MsgKey, vars?: Vars) => string;

export function translate(lang: Lang, key: MsgKey, vars?: Vars): string {
  const s = dicts[lang][key] ?? en[key];
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Pick the singular message for n === 1, the plural (with {n}) otherwise. */
export function plural(t: TFn, n: number, one: MsgKey, many: MsgKey, vars?: Vars): string {
  return n === 1 ? t(one, vars) : t(many, { ...vars, n });
}

/** Current language and a bound t(). Re-renders when the officer switches language. */
export function useT(): { t: TFn; lang: Lang } {
  const { lang } = useAuth();
  const t = useCallback<TFn>((key, vars) => translate(lang, key, vars), [lang]);
  return { t, lang };
}

// ---------- dates (always IST; YYYY-MM-DD strings are formatted as UTC so the device zone never leaks in) ----------

const LOCALE: Record<Lang, string> = { en: 'en-IN', hi: 'hi-IN' };

function fmt(ymd: string, lang: Lang, opts: Intl.DateTimeFormatOptions): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return new Intl.DateTimeFormat(LOCALE[lang], { ...opts, timeZone: 'UTC' }).format(d);
}

/** "Monday, 9 November" */
export function formatDayLong(ymd: string, lang: Lang): string {
  return fmt(ymd, lang, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** "9 Nov" */
export function formatDateShort(ymd: string, lang: Lang): string {
  return fmt(ymd, lang, { day: 'numeric', month: 'short' });
}

/** "9 Nov 2026" */
export function formatDateMedium(ymd: string, lang: Lang): string {
  return fmt(ymd, lang, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "9 Nov, 11:20 AM" in IST. */
export function formatInstant(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${formatDateShort(istDate(d), lang)}, ${istTimeLabel(d)}`;
}

/** "3h 12m" */
export function formatDuration(minutes: number, t: TFn): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? t('dur.hm', { h, m }) : t('dur.m', { m });
}

/** "Today", "Tomorrow", "In 3 days" or a short date. */
export function formatRelativeDate(ymd: string, today: string, lang: Lang, t: TFn): string {
  const diff = Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return t('rel.today');
  if (diff === 1) return t('rel.tomorrow');
  if (diff > 1 && diff <= 7) return t('rel.inDays', { n: diff });
  return formatDateShort(ymd, lang);
}
