import { accountPlans, faqItems, roomSubscriptionPlans } from './marketingContent.js';
import { DEFAULT_LOCALE, normalizeLocale } from '../lib/i18n.js';

export const HELP_TOPIC_KEYS = Object.freeze(['basics', 'rooms', 'plans', 'ai', 'people', 'privacy']);

const topicKeyByEnglishTopic = Object.freeze({
  Basics: 'basics',
  Rooms: 'rooms',
  Plans: 'plans',
  AI: 'ai',
  People: 'people',
  Privacy: 'privacy',
});

const topicLabels = Object.freeze({
  en: Object.freeze({ basics: 'Basics', rooms: 'Rooms', plans: 'Plans', ai: 'AI', people: 'People', privacy: 'Privacy' }),
  es: Object.freeze({ basics: 'Conceptos básicos', rooms: 'Salas', plans: 'Planes', ai: 'IA', people: 'Personas', privacy: 'Privacidad' }),
  'zh-Hans': Object.freeze({ basics: '基础', rooms: '房间', plans: '套餐', ai: 'AI', people: '联系人', privacy: '隐私' }),
});

const translations = Object.freeze({
  es: Object.freeze({
    'what-is-minimalist': Object.freeze({
      question: '¿Qué es Minimalist?',
      answer: 'Minimalist es una aplicación de comunicación centrada en salas, diseñada para que los chats grupales sean más tranquilos y organizados. En una sala puedes reunir conversaciones, resúmenes para ponerte al día, decisiones, tareas, documentos, pizarras, eventos, llamadas, búsquedas y flujos de trabajo asistidos por IA en un solo lugar.',
    }),
    'create-or-join-room': Object.freeze({
      question: '¿Cómo creo una sala o me uno a una?',
      answer: 'Abre la barra lateral de salas y elige Nueva sala para crear un grupo de amigos o una comunidad visible en el buscador. Elige Unirse para entrar en otra sala mediante su enlace o código de invitación.',
    }),
    'room-tools': Object.freeze({
      question: '¿Qué puede hacer mi grupo dentro de una sala?',
      answer: 'Empieza con el chat y usa las herramientas que necesite tu grupo: archivos, encuestas, recordatorios, Docs, Whiteboard, tareas, eventos, llamadas, compartir pantalla, búsqueda, moderación e IA. El acceso puede depender de la sala, tus permisos, tu plan y tu dispositivo.',
    }),
    'room-access': Object.freeze({
      question: '¿Quién controla el acceso y los permisos de una sala?',
      answer: 'Las personas que crean las salas y los administradores autorizados controlan los miembros, los roles, los permisos de las funciones y si una comunidad puede descubrirse. Las salas privadas están limitadas a sus miembros; los espacios públicos o visibles pueden tener un alcance más amplio. Las reglas de seguridad de la plataforma se aplican en todas las salas.',
    }),
    'account-vs-room-plans': Object.freeze({
      question: '¿En qué se diferencian los planes de cuenta y las suscripciones de sala?',
      answer: 'Un plan de cuenta acompaña a una persona con sesión iniciada en todas las salas. Una suscripción de sala opcional es una compra recurrente independiente para una sola sala privada; la gestiona quien creó la sala y asigna ventajas de la sala a miembros seleccionados. Una ventaja de sala nunca reduce una ventaja superior incluida en el plan de cuenta de una persona.',
    }),
    'paid-plan-costs': Object.freeze({
      question: '¿Cuánto cuestan los planes de pago?',
      answer: 'Base es gratis. Las cuentas {advancedAccountName} cuestan {advancedAccountPrice} y las cuentas {proAccountName}, {proAccountPrice}. La suscripción independiente {advancedRoomName} cuesta {advancedRoomPrice} para un máximo de {advancedRoomMemberLimit} miembros seleccionados, mientras que {proRoomName} cuesta {proRoomPrice} para un máximo de {proRoomMemberLimit}. Stripe Checkout muestra el precio vigente y las condiciones de renovación antes de la compra.',
    }),
    'manage-subscription': Object.freeze({
      question: '¿Cómo gestiono o cancelo una suscripción?',
      answer: 'Abre Configuración, elige Facturación y usa Gestionar suscripción para un plan de cuenta. Quien creó una sala gestiona la suscripción de esa sala desde el panel Facturación de la sala. Stripe permite consultar facturas, actualizar métodos de pago, cambiar de plan y cancelar en línea. La cancelación se programa para el final del período de facturación actual; eliminar una cuenta, salir de una sala o desinstalar la aplicación no equivale a cancelar la suscripción.',
    }),
    'ai-and-winston': Object.freeze({
      question: '¿Qué pueden hacer las herramientas de IA y Winston?',
      answer: 'La IA de sala puede ayudar a resumir conversaciones, extraer tareas, analizar patrones y preparar detalles de eventos. Las cuentas Pro también incluyen Winston, un agente personal de IA. La IA usa Bananas u otros límites de uso mostrados, puede no estar disponible mientras se recupera la capacidad y puede generar resultados incorrectos; revisa los resultados importantes antes de usarlos.',
    }),
    'ai-room-information': Object.freeze({
      question: '¿Cómo utiliza la IA la información de una sala?',
      answer: 'Cuando haces una solicitud de IA, la pasarela autenticada de Minimalist puede procesar tu instrucción junto con un conjunto limitado de mensajes, tareas, documentos y eventos relevantes de una sala a la que puedes acceder. Los proveedores de IA configurados pueden procesar esa solicitud. No envíes secretos ni contenido que no tengas permiso para compartir, y no uses la IA como asesoramiento profesional.',
    }),
    'friends-and-private-messages': Object.freeze({
      question: '¿Cómo añado amigos y envío mensajes privados?',
      answer: 'Abre Contactos para buscar personas, enviar o aceptar solicitudes e iniciar una conversación privada. El historial reciente de mensajes privados sigue disponible en la bandeja de entrada de mensajes privados, y las conversaciones compatibles también permiten iniciar una llamada de voz directa.',
    }),
    'content-visibility': Object.freeze({
      question: '¿Quién puede ver el contenido de mis salas y mensajes privados?',
      answer: 'El contenido de las salas privadas está restringido por las reglas de membresía y permisos, y los mensajes privados están limitados a sus participantes. Minimalist sigue utilizando servicios en la nube para almacenar y procesar contenido, y no afirma que todas las salas o mensajes privados estén cifrados de extremo a extremo. El cifrado opcional de mensajes privados solo protege los mensajes enviados después de que ambos participantes lo activen con la misma frase de contraseña.',
    }),
    'delete-account': Object.freeze({
      question: '¿Qué ocurre cuando elimino mi cuenta?',
      answer: 'En Configuración puedes eliminar permanentemente tu perfil y tu cuenta de autenticación tras escribir una confirmación; puede que se requiera un inicio de sesión reciente. La eliminación no cancela automáticamente las suscripciones de pago ni garantiza que se elimine el contenido que ya se compartió en salas, que otros participantes conservaron o que se retiene por motivos de facturación, seguridad o legales. Cancela primero las suscripciones y ponte en contacto con soporte para realizar una solicitud relacionada con tus datos.',
    }),
  }),
  'zh-Hans': Object.freeze({
    'what-is-minimalist': Object.freeze({
      question: 'Minimalist 是什么？',
      answer: 'Minimalist 是一款以房间为中心的沟通应用，让群聊更安静、更有条理。一个房间可以把对话、回顾摘要、决策、任务、文档、白板、活动、通话、搜索和 AI 辅助工作流集中在一处。',
    }),
    'create-or-join-room': Object.freeze({
      question: '如何创建或加入房间？',
      answer: '打开房间侧边栏，选择“新建房间”来创建好友群组或可被发现的社区。选择“加入”，通过邀请链接或代码进入其他房间。',
    }),
    'room-tools': Object.freeze({
      question: '我的群组可以在房间里做什么？',
      answer: '先从聊天开始，再按需使用文件、投票、提醒、Docs、Whiteboard、任务、活动、通话、屏幕共享、搜索、内容管理和 AI 等工具。可用功能可能取决于房间、你的权限、你的套餐和设备。',
    }),
    'room-access': Object.freeze({
      question: '谁控制房间访问权限？',
      answer: '房间创建者和获得授权的管理员可以管理成员、角色、功能权限，以及社区是否可被发现。私人房间仅对其成员开放；公开或可被发现的空间可能面向更广泛的人群。每个房间仍须遵守平台安全规则。',
    }),
    'account-vs-room-plans': Object.freeze({
      question: '账户套餐与房间订阅有何区别？',
      answer: '账户套餐会跟随一个已登录用户，适用于其加入的各个房间。可选的房间订阅是针对一个私人房间的独立周期性购买，由房间创建者管理，并为选定成员分配房间权益。房间权益绝不会降低用户账户套餐中更高的权益。',
    }),
    'paid-plan-costs': Object.freeze({
      question: '付费套餐多少钱？',
      answer: 'Base 免费。{advancedAccountName} 账户为 {advancedAccountPrice}，{proAccountName} 账户为 {proAccountPrice}。独立的 {advancedRoomName} 订阅价格为 {advancedRoomPrice}，最多可供 {advancedRoomMemberLimit} 名选定成员使用；{proRoomName} 价格为 {proRoomPrice}，最多可供 {proRoomMemberLimit} 名选定成员使用。购买前，Stripe Checkout 会显示当前价格和续订条款。',
    }),
    'manage-subscription': Object.freeze({
      question: '如何管理或取消订阅？',
      answer: '打开“设置”，选择“账单”，然后对账户套餐使用“管理订阅”。房间创建者可在该房间的“账单”面板中管理房间订阅。Stripe 提供发票、付款方式更新、套餐变更和在线取消功能。取消将在当前计费周期结束时生效；删除账户、退出房间或卸载应用都不能代替取消订阅。',
    }),
    'ai-and-winston': Object.freeze({
      question: 'AI 工具和 Winston 能做什么？',
      answer: '房间 AI 可以帮助总结对话、提取任务、分析模式并准备活动详情。Pro 账户还包含 Winston 个人 AI 智能体。AI 会消耗 Bananas 或受界面所示的其他用量限制约束；在容量恢复期间可能暂时不可用，也可能生成错误结果，因此请在使用前检查重要内容。',
    }),
    'ai-room-information': Object.freeze({
      question: 'AI 如何使用房间信息？',
      answer: '当你发起 AI 请求时，Minimalist 的认证网关可以处理你的提示，以及你有权访问的某个房间内一组有限的相关消息、任务、文档和活动。已配置的 AI 提供商可能会处理该请求。请勿提交秘密信息或你无权分享的内容，也不要把 AI 当作专业意见。',
    }),
    'friends-and-private-messages': Object.freeze({
      question: '如何添加好友并发送私信？',
      answer: '打开“联系人”即可搜索用户、发送或接受好友请求，并开始私聊。近期私信记录会保留在私信收件箱中；受支持的会话还可直接发起语音通话。',
    }),
    'content-visibility': Object.freeze({
      question: '谁能看到我的房间和私信内容？',
      answer: '私人房间内容受成员资格和权限规则限制，私信仅限参与者查看。Minimalist 仍会使用云服务存储和处理内容，并不声称每个房间或每条私信都采用端到端加密。可选的私信加密仅保护双方使用相同密码短语启用该功能后发送的消息。',
    }),
    'delete-account': Object.freeze({
      question: '删除账户后会发生什么？',
      answer: '在“设置”中输入确认信息后，你可以永久删除个人资料和身份验证账户；系统可能要求你近期重新登录。删除账户不会自动取消付费订阅，也无法保证删除已经在房间中分享、被其他参与者保留，或因账单、安全或法律原因而留存的内容。请先取消订阅，再联系支持团队提出数据请求。',
    }),
  }),
});

function interpolate(message, values) {
  return String(message).replace(/\{([\w.-]+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  ));
}

function planById(plans, id) {
  return plans.find((plan) => plan.id === id);
}

function monthlyPrice(plan, locale) {
  const amount = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(Number(plan.price));
  if (locale === 'es') return `${amount}/mes`;
  if (locale === 'zh-Hans') return `${amount}/月`;
  return `${amount}/month`;
}

function pricingValues(locale) {
  const advancedAccount = planById(accountPlans, 'advanced');
  const proAccount = planById(accountPlans, 'pro');
  const advancedRoom = planById(roomSubscriptionPlans, 'advanced-room');
  const proRoom = planById(roomSubscriptionPlans, 'pro-room');
  return {
    advancedAccountName: advancedAccount.name,
    advancedAccountPrice: monthlyPrice(advancedAccount, locale),
    proAccountName: proAccount.name,
    proAccountPrice: monthlyPrice(proAccount, locale),
    advancedRoomName: advancedRoom.name,
    advancedRoomPrice: monthlyPrice(advancedRoom, locale),
    advancedRoomMemberLimit: advancedRoom.selectedMemberLimit,
    proRoomName: proRoom.name,
    proRoomPrice: monthlyPrice(proRoom, locale),
    proRoomMemberLimit: proRoom.selectedMemberLimit,
  };
}

export function getHelpTopicLabel(topicKey, locale = DEFAULT_LOCALE) {
  const normalized = normalizeLocale(locale) || DEFAULT_LOCALE;
  return topicLabels[normalized]?.[topicKey] || topicLabels.en[topicKey] || topicKey;
}

export function getLocalizedHelpItems(locale = DEFAULT_LOCALE) {
  const normalized = normalizeLocale(locale) || DEFAULT_LOCALE;
  const localizedItems = translations[normalized] || {};
  const values = pricingValues(normalized);
  return faqItems.map((item) => {
    const translation = localizedItems[item.id];
    const topicKey = topicKeyByEnglishTopic[item.topic];
    return Object.freeze({
      ...item,
      topicKey,
      topic: getHelpTopicLabel(topicKey, normalized),
      question: translation?.question || item.question,
      answer: translation ? interpolate(translation.answer, values) : item.answer,
    });
  });
}

export const HELP_QUICK_PATHS = Object.freeze([
  Object.freeze({ id: 'getting-started', topicKey: 'basics', labelKey: 'help.quick.gettingStarted', icon: 'ph-rocket-launch' }),
  Object.freeze({ id: 'rooms-permissions', topicKey: 'rooms', labelKey: 'help.quick.rooms', icon: 'ph-door-open' }),
  Object.freeze({ id: 'billing-plans', topicKey: 'plans', labelKey: 'help.quick.billing', icon: 'ph-credit-card' }),
  Object.freeze({ id: 'privacy-safety', topicKey: 'privacy', labelKey: 'help.quick.privacy', icon: 'ph-shield-check' }),
]);
