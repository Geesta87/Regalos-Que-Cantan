import React, { useContext } from 'react';
import { AppContext } from '../../App';
import SEOHead, { generateFAQStructuredData, generateBreadcrumbData } from '../../components/SEOHead';
import SEOLink from '../../components/SEOLink';

const FAQ_CATEGORIES = [
  {
    title: 'Sobre el Servicio',
    faqs: [
      {
        question: '¿Qué es RegalosQueCantan?',
        answer: 'RegalosQueCantan es un servicio que crea canciones personalizadas en más de 20 géneros latinos. Tú proporcionas los detalles — nombre, ocasión, mensaje — y nosotros componemos una canción única lista para descargar y compartir.'
      },
      {
        question: '¿La canción es realmente única?',
        answer: 'Sí, cada canción es 100% original. Se genera letra y música desde cero basándose en los detalles que tú proporcionas. Nadie más tendrá la misma canción.'
      },
      {
        question: '¿En qué géneros puedo crear canciones?',
        answer: 'Ofrecemos más de 20 géneros latinos: corridos tumbados, corrido clásico, banda sinaloense, norteño, cumbia (norteña, colombiana, texana), mariachi, bachata, reggaeton, salsa, bolero, ranchera, regional mexicano, pop latino, balada, vallenato, merengue, huapango y son jarocho.'
      },
      {
        question: '¿Necesito saber de música para crear una canción?',
        answer: 'No, para nada. Solo necesitas elegir el género, escribir los nombres y detalles que quieres incluir, y nos encargamos del resto. No necesitas ningún conocimiento musical.'
      }
    ]
  },
  {
    title: 'Precio y Pago',
    faqs: [
      {
        question: '¿Cuánto cuesta una canción personalizada?',
        answer: 'Las canciones empiezan desde $24.99. Ofrecemos diferentes planes: 1 canción ($24.99), 2 canciones ($39.99) y Premium ($49.99) que incluye ambas versiones más extras.'
      },
      {
        question: '¿Qué métodos de pago aceptan?',
        answer: 'Aceptamos todas las tarjetas de crédito y débito principales (Visa, Mastercard, American Express) a través de Stripe, una de las plataformas de pago más seguras del mundo.'
      },
      {
        question: '¿Es un pago único o suscripción?',
        answer: 'Es un pago único. No hay suscripciones, cargos recurrentes ni costos ocultos. Pagas una vez y la canción es tuya para siempre.'
      },
      {
        question: '¿Ofrecen reembolsos?',
        answer: 'Generamos dos versiones diferentes para que tengas opciones. Si ninguna te convence, contáctanos y buscaremos una solución. Tu satisfacción es nuestra prioridad.'
      }
    ]
  },
  {
    title: 'La Canción',
    faqs: [
      {
        question: '¿Cuánto tiempo tarda en crearse la canción?',
        answer: 'Tu canción personalizada estará lista en solo 2-4 minutos. Se generan dos versiones únicas para que elijas tu favorita o te quedes con ambas.'
      },
      {
        question: '¿Puedo escuchar la canción antes de pagar?',
        answer: 'Sí, escuchas un preview de 20 segundos de cada versión antes de decidir. Así puedes asegurarte de que te encanta antes de completar tu compra.'
      },
      {
        question: '¿En qué formato recibo la canción?',
        answer: 'Recibes un archivo MP3 de alta calidad que puedes descargar inmediatamente y compartir por WhatsApp, redes sociales, email o reproducir en cualquier dispositivo.'
      },
      {
        question: '¿La canción tiene voz o es solo instrumental?',
        answer: 'Cada canción incluye voces profesionales generadas por IA que cantan la letra personalizada. Puedes elegir entre voz masculina o femenina.'
      },
      {
        question: '¿Cuánto dura la canción?',
        answer: 'Las canciones duran entre 2 y 3 minutos aproximadamente, similar a una canción comercial. Es la duración perfecta para escuchar, compartir y disfrutar.'
      }
    ]
  },
  {
    title: 'Personalización',
    faqs: [
      {
        question: '¿Qué detalles puedo incluir en la canción?',
        answer: 'Puedes incluir nombres, apodos cariñosos, la ocasión, memorias especiales, logros, mensajes de amor, agradecimiento o cualquier detalle que quieras mencionar. Cuantos más detalles des, más personalizada será la canción.'
      },
      {
        question: '¿Puedo mencionar la edad del festejado?',
        answer: 'Sí, puedes incluir edad, nombre, apodo y cualquier detalle especial. La canción mencionará todo lo que tú quieras para hacerla única.'
      },
      {
        question: '¿Puedo crear una canción en inglés?',
        answer: 'Actualmente nos especializamos en canciones en español para la comunidad latina. Las canciones se generan en español con la autenticidad de cada género.'
      }
    ]
  },
  {
    title: 'Uso y Compartir',
    faqs: [
      {
        question: '¿Puedo usar la canción en mi boda o evento?',
        answer: 'Absolutamente. Muchos clientes usan nuestras canciones como primer baile de boda, vals de quinceañera o para sorpresas en eventos. La canción es tuya para usarla como quieras.'
      },
      {
        question: '¿Puedo compartir la canción por WhatsApp?',
        answer: 'Sí, puedes descargar el MP3 y compartirlo por WhatsApp, Messenger, email, redes sociales o cualquier plataforma. También puedes reproducirla en altavoces durante eventos.'
      },
      {
        question: '¿La canción caduca o la pierdo?',
        answer: 'No, la canción es tuya para siempre. Una vez que la descargas, el archivo MP3 es tuyo permanentemente. También puedes volver a descargarla desde tu email de confirmación.'
      }
    ]
  }
];

// Flatten all FAQs for schema
const ALL_FAQS = FAQ_CATEGORIES.flatMap(cat => cat.faqs);

export default function PreguntasFrecuentes() {
  const { navigateTo } = useContext(AppContext);

  const breadcrumbs = [
    { name: 'Inicio', path: '/' },
    { name: 'Preguntas Frecuentes', path: '/preguntas-frecuentes' }
  ];

  const structuredData = [
    generateFAQStructuredData(ALL_FAQS),
    generateBreadcrumbData(breadcrumbs)
  ];

  return (
    <>
      <SEOHead
        title="Preguntas Frecuentes — Canciones Personalizadas"
        description="Respuestas a todas tus preguntas sobre canciones personalizadas en RegalosQueCantan. Precios, géneros, tiempos de entrega, personalización y más."
        canonical="/preguntas-frecuentes"
        keywords="preguntas frecuentes regalos que cantan, FAQ canciones personalizadas, dudas canciones IA, cómo funciona canción personalizada"
        structuredData={structuredData}
      />

      <div className="min-h-screen bg-landing-bg text-white" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        {/* Hero */}
        <section className="relative py-24 px-6 overflow-hidden">
          <div className="absolute inset-0 opacity-30" style={{ background: 'radial-gradient(ellipse at center top, #7C3AED40 0%, transparent 70%)' }} />
          <div className="relative max-w-4xl mx-auto text-center">
            <nav className="mb-10" aria-label="Breadcrumb">
              <ol className="flex items-center justify-center gap-2 text-sm text-white/50">
                {breadcrumbs.map((item, index) => (
                  <li key={item.path} className="flex items-center gap-2">
                    {index > 0 && <span className="text-white/30">/</span>}
                    {index === breadcrumbs.length - 1 ? (
                      <span className="text-white/80 font-medium">{item.name}</span>
                    ) : (
                      <SEOLink to="landing" className="hover:text-white transition-colors">{item.name}</SEOLink>
                    )}
                  </li>
                ))}
              </ol>
            </nav>

            <h1 className="text-4xl md:text-6xl font-bold mb-5 font-display">
              Preguntas Frecuentes
            </h1>
            <p className="text-xl text-white/60 max-w-2xl mx-auto leading-relaxed">
              Todo lo que necesitas saber sobre canciones personalizadas
            </p>
          </div>
        </section>

        {/* FAQ Categories */}
        <section className="py-12 px-6">
          <div className="max-w-3xl mx-auto space-y-16">
            {FAQ_CATEGORIES.map((category) => (
              <div key={category.title}>
                <h2 className="text-2xl md:text-3xl font-bold mb-8 font-display flex items-center gap-3">
                  <span className="w-1 h-8 rounded-full" style={{ background: 'linear-gradient(135deg, #c9184a, #7C3AED)' }} />
                  {category.title}
                </h2>
                <div className="space-y-4">
                  {category.faqs.map((faq, index) => (
                    <details key={index} className="glass-morphism rounded-2xl p-6 group">
                      <summary className="font-bold text-white cursor-pointer flex justify-between items-center">
                        {faq.question}
                        <span className="text-white/40 group-open:rotate-180 transition-transform ml-4 flex-shrink-0">▼</span>
                      </summary>
                      <p className="text-white/60 mt-4 leading-relaxed">{faq.answer}</p>
                    </details>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Still have questions + CTA */}
        <section className="relative py-24 px-6 overflow-hidden">
          <div className="absolute inset-0 opacity-20" style={{ background: 'radial-gradient(ellipse at center, #c9184a30 0%, transparent 70%)' }} />
          <div className="relative max-w-2xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-5 font-display">
              ¿Tienes otra pregunta?
            </h2>
            <p className="text-white/60 mb-10 text-lg">
              Escríbenos por WhatsApp y te respondemos al instante. O si ya estás listo...
            </p>
            <button
              onClick={() => navigateTo('genre')}
              className="px-12 py-5 rounded-full text-xl font-bold transition-all transform hover:scale-105 animate-pulse-glow"
              style={{ background: 'linear-gradient(135deg, #c9184a, #a01540)', color: 'white', boxShadow: '0 4px 30px rgba(201, 24, 74, 0.4)' }}
            >
              🎤 Crear Mi Canción Ahora
            </button>
            <div className="mt-8 flex items-center justify-center gap-6 text-sm text-white/40">
              <span>✓ Desde $24.99</span>
              <span>✓ Listo en minutos</span>
              <span>✓ Satisfacción garantizada</span>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-10 px-6 border-t border-white/5 text-center">
          <p className="text-white/30 text-sm">© {new Date().getFullYear()} RegalosQueCantan. Todos los derechos reservados.</p>
          <p className="mt-2 text-white/20 text-sm">Canciones personalizadas en géneros latinos para cada ocasión especial.</p>
        </footer>
      </div>
    </>
  );
}
