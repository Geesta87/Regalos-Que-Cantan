/**
 * SEO Data for RegalosQueCantan
 * Contains all genre and occasion information for SEO landing pages
 */

// ============================================
// DEFAULT FAQ DATA
// ============================================
export const DEFAULT_GENRE_FAQS = [
  {
    question: '¿Cuánto tiempo tarda en crearse la canción?',
    answer: 'Tu canción personalizada estará lista en solo 2-4 minutos. Nuestra IA genera dos versiones únicas para que elijas tu favorita o te quedes con ambas.'
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
    question: '¿Qué pasa si no me gusta la canción?',
    answer: 'Generamos dos versiones diferentes para que tengas opciones. Si ninguna te convence completamente, contáctanos y buscaremos una solución para que quedes satisfecho.'
  }
];

export const DEFAULT_OCCASION_FAQS = [
  {
    question: '¿Cuánto tiempo tarda en crearse la canción?',
    answer: 'Tu canción estará lista en solo 2-4 minutos. Nuestra IA genera dos versiones únicas para que elijas tu favorita.'
  },
  {
    question: '¿Puedo escuchar la canción antes de pagar?',
    answer: 'Sí, escuchas un preview de 20 segundos de cada versión antes de decidir. Así puedes asegurarte de que te encanta.'
  },
  {
    question: '¿En qué formato recibo la canción?',
    answer: 'Recibes un archivo MP3 de alta calidad que puedes descargar inmediatamente y compartir por WhatsApp, redes sociales o email.'
  },
  {
    question: '¿Qué pasa si no me gusta la canción?',
    answer: 'Ofrecemos dos versiones diferentes para que tengas opciones. Si ninguna te convence, contáctanos y buscaremos una solución.'
  }
];

// ============================================
// GENRES DATA
// ============================================
export const GENRES_SEO = {
  'corridos-tumbados': {
    id: 'corridos-tumbados',
    name: 'Corridos Tumbados',
    slug: 'corridos-tumbados',
    title: 'Corridos Tumbados Personalizados con IA',
    metaDescription: 'Crea un corrido tumbado personalizado único con IA. Estilo Peso Pluma, Junior H, Natanael Cano. Letra con el nombre de tu ser querido. Listo en minutos desde $29.99.',
    keywords: 'corridos tumbados, corrido personalizado, peso pluma, junior h, natanael cano, corrido con nombre, regalo corrido, música regional mexicana',
    heroTitle: 'Corridos Tumbados Personalizados',
    heroSubtitle: 'El regalo más chingón con el flow que está rompiendo',
    description: 'Crea un corrido tumbado único con inteligencia artificial. Incluye el nombre de tu ser querido, menciona sus logros, y sorpréndelos con el género más popular del momento.',
    definitionBlock: 'Un corrido tumbado personalizado es una canción original que fusiona corrido mexicano con trap y hip-hop, creada con IA para incluir el nombre y la historia de tu ser querido. Con el flow de artistas como Peso Pluma y Junior H, es un regalo único listo en minutos desde $29.99.',
    longDescription: `Los corridos tumbados han revolucionado la música regional mexicana, mezclando el corrido tradicional con trap y hip-hop. Artistas como Peso Pluma, Junior H, y Natanael Cano han llevado este género a los charts mundiales.

Ahora puedes regalar un corrido tumbado completamente personalizado. Nuestra IA crea letras únicas que mencionan el nombre de tu ser querido, sus características especiales, y la ocasión que celebras. El resultado es una canción profesional que suena como si fuera de tus artistas favoritos.

Perfecto para cumpleaños, graduaciones, o simplemente para sorprender a alguien especial con un regalo que nunca olvidarán.`,
    artists: ['Peso Pluma', 'Junior H', 'Natanael Cano', 'Fuerza Regida', 'Eslabón Armado'],
    sampleLyrics: 'Ejemplo: "Esta canción va pa\' [Nombre], el más cabrón del barrio..."',
    color: '#8B5CF6',
    icon: '🎤',
    popularFor: ['Cumpleaños', 'Graduaciones', 'Logros personales', 'Día del Padre'],
    reviewCount: 89,
    featured: true,
    faqs: [
      { question: '¿Cómo suena un corrido tumbado personalizado?', answer: 'Suena como las canciones de Peso Pluma o Junior H pero con la letra completamente personalizada. Incluye el nombre de tu ser querido, menciones de sus logros y el flow característico del género.' },
      { question: '¿Puedo elegir el estilo de artista para mi corrido tumbado?', answer: 'Sí, nuestra IA puede crear corridos tumbados inspirados en el estilo de artistas como Peso Pluma, Natanael Cano, Junior H o Fuerza Regida. Tú eliges el vibe.' },
      { question: '¿Es un buen regalo para un joven?', answer: 'Definitivamente. Los corridos tumbados son el género más popular entre jóvenes latinos. Es un regalo moderno, original y que demuestra que conoces sus gustos musicales.' },
      ...DEFAULT_GENRE_FAQS
    ]
  },

  'corrido-clasico': {
    id: 'corrido-clasico',
    name: 'Corrido Clásico',
    slug: 'corrido-clasico',
    title: 'Corridos Clásicos Personalizados',
    metaDescription: 'Crea un corrido clásico tradicional personalizado con IA. Estilo Los Tigres del Norte, Los Tucanes. Historia de vida en canción. Desde $29.99.',
    keywords: 'corrido clásico, corrido tradicional, los tigres del norte, corrido mexicano, corrido personalizado',
    heroTitle: 'Corridos Clásicos Personalizados',
    heroSubtitle: 'La tradición del corrido mexicano con tu historia',
    description: 'El corrido clásico cuenta historias de vida, hazañas y amor. Crea uno personalizado que narre la historia de tu ser querido.',
    definitionBlock: 'Un corrido clásico personalizado es una canción narrativa en el estilo tradicional del corrido mexicano, creada con IA para contar la historia de vida de tu ser querido. Con acordeón, bajo sexto y guitarra, narra sus logros y hazañas como las grandes canciones de Los Tigres del Norte.',
    longDescription: `El corrido es una de las tradiciones musicales más importantes de México. Desde "La Cucaracha" hasta "Contrabando y Traición", los corridos han contado las historias del pueblo mexicano por generaciones.

Con RegalosQueCantan, puedes crear un corrido clásico que cuente la historia de alguien especial. Ya sea su trayectoria de vida, sus logros, o simplemente lo mucho que significa para ti, nuestra IA crea letras narrativas en el estilo tradicional del corrido.`,
    artists: ['Los Tigres del Norte', 'Los Tucanes de Tijuana', 'Chalino Sánchez'],
    color: '#DC2626',
    icon: '🎺',
    popularFor: ['Día del Padre', 'Jubilaciones', 'Homenajes', 'Cumpleaños'],
    reviewCount: 67
  },
  
  'banda-sinaloense': {
    id: 'banda-sinaloense',
    name: 'Banda Sinaloense',
    slug: 'banda-sinaloense',
    title: 'Canciones de Banda Sinaloense Personalizadas',
    metaDescription: 'Crea una canción de banda sinaloense personalizada con IA. Estilo Banda MS, El Recodo, Julión Álvarez. Con metales, tuba y nombre personalizado. Desde $29.99.',
    keywords: 'banda sinaloense, banda ms, el recodo, julión álvarez, canción de banda, música de banda personalizada',
    heroTitle: 'Banda Sinaloense Personalizada',
    heroSubtitle: 'El sonido de Sinaloa con tu mensaje especial',
    description: 'La banda sinaloense es sinónimo de fiesta y celebración. Crea una canción con el sonido característico de metales, tuba y clarinete.',
    definitionBlock: 'Una canción de banda sinaloense personalizada es una pieza musical original con metales, tuba y clarinete, creada con IA e inspirada en el sonido de Banda MS y El Recodo. Incluye el nombre de tu ser querido y un mensaje especial, perfecta para bodas, quinceañeras y fiestas.',
    longDescription: `La Banda Sinaloense es el sonido de las fiestas mexicanas. Con su característico conjunto de metales, tubas y clarinetes, este género ha conquistado corazones en todo el mundo.

Tu canción personalizada incluirá el nombre de tu ser querido, un mensaje especial, y todo el poder musical de la banda sinaloense. Perfecta para bodas, quinceañeras, cumpleaños y cualquier celebración que merezca música en grande.`,
    artists: ['Banda MS', 'Banda El Recodo', 'Julión Álvarez', 'La Adictiva'],
    color: '#F59E0B',
    icon: '🎷',
    popularFor: ['Bodas', 'Quinceañeras', 'Cumpleaños', 'Fiestas'],
    reviewCount: 124,
    featured: true,
    faqs: [
      { question: '¿Cómo suena una canción de banda personalizada?', answer: 'Suena como Banda MS o El Recodo con metales, tuba y clarinete, pero la letra es 100% personalizada con el nombre de tu ser querido y tu mensaje especial.' },
      { question: '¿Es buena opción para una fiesta?', answer: 'La banda sinaloense es perfecta para fiestas, bodas y quinceañeras. Tu canción personalizada será el momento más especial de la celebración.' },
      ...DEFAULT_GENRE_FAQS
    ]
  },

  'norteno': {
    id: 'norteno',
    name: 'Norteño',
    slug: 'norteno',
    title: 'Música Norteña Personalizada con IA',
    metaDescription: 'Crea una canción norteña personalizada con acordeón y bajo sexto. Estilo Intocable, Ramón Ayala, Pesado. Regalo único desde $29.99.',
    keywords: 'música norteña, norteño, intocable, ramón ayala, acordeón, bajo sexto, canción norteña personalizada',
    heroTitle: 'Música Norteña Personalizada',
    heroSubtitle: 'Acordeón y bajo sexto con tu mensaje de amor',
    description: 'El norteño es el corazón de la música del norte de México. Acordeón, bajo sexto y letras que llegan al alma.',
    definitionBlock: 'Una canción norteña personalizada es una pieza original con acordeón y bajo sexto creada con IA, inspirada en artistas como Intocable y Ramón Ayala. Incluye el nombre de tu ser querido y un mensaje personal, capturando la esencia romántica y emotiva del norte de México.',
    longDescription: `La música norteña representa el alma del norte de México y sur de Texas. Con su característico sonido de acordeón y bajo sexto, el norteño ha enamorado a generaciones.

Crea una canción norteña personalizada que incluya el nombre de tu ser querido y un mensaje especial. Ya sea una canción de amor, de amistad, o de celebración, nuestra IA captura la esencia del género norteño.`,
    artists: ['Intocable', 'Ramón Ayala', 'Pesado', 'Los Invasores de Nuevo León'],
    color: '#059669',
    icon: '🪗',
    popularFor: ['Aniversarios', 'Declaraciones de amor', 'Día de las Madres', 'Serenatas'],
    reviewCount: 98
  },
  
  'cumbia': {
    id: 'cumbia',
    name: 'Cumbia',
    slug: 'cumbia',
    title: 'Cumbia Personalizada con IA',
    metaDescription: 'Crea una cumbia personalizada con IA. Ritmo contagioso, güiro y acordeón. Perfecta para fiestas y celebraciones. Desde $29.99.',
    keywords: 'cumbia, cumbia personalizada, música para fiesta, canción de cumbia, regalo musical',
    heroTitle: 'Cumbia Personalizada',
    heroSubtitle: 'El ritmo que pone a bailar a todos con tu mensaje',
    description: 'La cumbia es el ritmo de la fiesta latinoamericana. Crea una canción que haga bailar a todos mientras celebra a tu ser querido.',
    definitionBlock: 'Una cumbia personalizada es una canción bailable creada con IA que incluye el nombre de tu ser querido y un mensaje especial. Con güiro, teclados y el ritmo contagioso que une a toda Latinoamérica, es el regalo perfecto para fiestas, cumpleaños y celebraciones familiares.',
    longDescription: `La cumbia es el género que une a toda Latinoamérica. Desde Colombia hasta México, Argentina y más allá, el ritmo de la cumbia hace bailar a todos.

Tu cumbia personalizada incluirá el nombre de tu ser querido, un mensaje especial, y ese ritmo contagioso que no deja a nadie quieto. Perfecta para cualquier celebración donde quieras que todos bailen y celebren.`,
    artists: ['Grupo Cañaveral', 'Los Ángeles Azules', 'Sonora Dinamita'],
    color: '#EC4899',
    icon: '💃',
    popularFor: ['Cumpleaños', 'Bodas', 'Fiestas', 'Quinceañeras'],
    reviewCount: 156,
    featured: true,
    demoAudio: '/sample-3.mp3',
    faqs: [
      { question: '¿Cómo suena una cumbia personalizada?', answer: 'Suena como las cumbias de Los Ángeles Azules o Sonora Dinamita — ritmo contagioso, güiro y teclados — pero con letra personalizada que menciona el nombre de tu ser querido.' },
      { question: '¿Es buena para una fiesta de cumpleaños?', answer: '¡Es perfecta! La cumbia pone a bailar a todos. Imagina la sorpresa cuando escuchen el nombre del festejado en una cumbia profesional.' },
      ...DEFAULT_GENRE_FAQS
    ]
  },

  'cumbia-nortena': {
    id: 'cumbia-nortena',
    name: 'Cumbia Norteña',
    slug: 'cumbia-nortena',
    title: 'Cumbia Norteña Personalizada',
    metaDescription: 'Crea una cumbia norteña con acordeón personalizada. Estilo Grupo Pesado, Bronco. Ritmo norteño con tu mensaje. Desde $29.99.',
    keywords: 'cumbia norteña, cumbia con acordeón, grupo pesado, bronco, cumbia mexicana',
    heroTitle: 'Cumbia Norteña Personalizada',
    heroSubtitle: 'El acordeón norteño con ritmo de cumbia',
    description: 'La fusión perfecta del norte de México: cumbia con acordeón y bajo sexto para una fiesta inolvidable.',
    definitionBlock: 'La cumbia norteña personalizada combina el ritmo de la cumbia con el acordeón y bajo sexto del norte de México. Creada con IA al estilo de Bronco y Grupo Pesado, incluye el nombre de tu ser querido para un regalo musical que pone a bailar a toda la familia.',
    artists: ['Bronco', 'Grupo Pesado', 'La Tropa Colombiana'],
    color: '#14B8A6',
    icon: '🎹',
    popularFor: ['Fiestas', 'Cumpleaños', 'Celebraciones familiares'],
    reviewCount: 45
  },
  
  'cumbia-colombiana': {
    id: 'cumbia-colombiana',
    name: 'Cumbia Colombiana',
    slug: 'cumbia-colombiana',
    title: 'Cumbia Colombiana Personalizada',
    metaDescription: 'Crea una cumbia colombiana tradicional personalizada con IA. El ritmo original de Colombia con tu mensaje especial. Desde $29.99.',
    keywords: 'cumbia colombiana, cumbia tradicional, ritmo colombiano, canción colombiana',
    heroTitle: 'Cumbia Colombiana Personalizada',
    heroSubtitle: 'El ritmo original de Colombia con tu dedicatoria',
    description: 'La cumbia en su forma más tradicional, directa desde Colombia. Gaitas, tambores y el sabor caribeño.',
    definitionBlock: 'La cumbia colombiana personalizada trae el ritmo original de Colombia con gaitas, tambores y sabor caribeño. Creada con IA, incluye el nombre de tu ser querido en una canción única que celebra con el sonido auténtico de los grandes como Aniceto Molina.',
    artists: ['Andrés Landero', 'Los Corraleros de Majagual', 'Aniceto Molina'],
    color: '#FBBF24',
    icon: '🥁',
    popularFor: ['Bodas', 'Aniversarios', 'Fiestas tropicales'],
    reviewCount: 38
  },
  
  'cumbia-texana': {
    id: 'cumbia-texana',
    name: 'Cumbia Texana',
    slug: 'cumbia-texana',
    title: 'Cumbia Texana Personalizada',
    metaDescription: 'Crea una cumbia texana personalizada con IA. El sonido de Texas con teclados y ritmo único. Desde $29.99.',
    keywords: 'cumbia texana, tejano, selena, kumbia kings, música texana',
    heroTitle: 'Cumbia Texana Personalizada',
    heroSubtitle: 'El sonido único de Texas con tu mensaje',
    description: 'La cumbia como se toca en Texas: teclados, sintetizadores y ese sabor único tex-mex.',
    definitionBlock: 'La cumbia texana personalizada captura el sonido único de Texas con teclados y sintetizadores al estilo de Selena y Kumbia Kings. Creada con IA, incluye el nombre de tu ser querido en una canción con el sabor tex-mex que define a la comunidad latina en Texas.',
    artists: ['Selena', 'Kumbia Kings', 'La Mafia'],
    color: '#8B5CF6',
    icon: '⭐',
    popularFor: ['Cumpleaños', 'Quinceañeras', 'Celebraciones tex-mex'],
    reviewCount: 52
  },
  
  'mariachi': {
    id: 'mariachi',
    name: 'Mariachi',
    slug: 'mariachi',
    title: 'Mariachi Personalizado con IA',
    metaDescription: 'Crea una canción de mariachi personalizada con IA. Trompetas, violines y guitarrón con el nombre de tu ser querido. Serenata perfecta desde $29.99.',
    keywords: 'mariachi, serenata, mariachi personalizado, vicente fernández, alejandro fernández, canción mexicana',
    heroTitle: 'Mariachi Personalizado',
    heroSubtitle: 'La serenata perfecta con tu mensaje de amor',
    description: 'El mariachi es el símbolo de México en el mundo. Trompetas, violines, guitarrón y voces que llegan al corazón.',
    definitionBlock: 'Un mariachi personalizado es una canción original con trompetas, violines y guitarrón, creada con IA para incluir el nombre de tu ser querido. Inspirada en la tradición de Vicente Fernández y Pedro Infante, es la serenata digital perfecta para el Día de las Madres, aniversarios y declaraciones de amor.',
    longDescription: `El mariachi es Patrimonio Cultural Inmaterial de la Humanidad por la UNESCO, y con razón. No hay sonido más mexicano que el de las trompetas, violines y guitarrones del mariachi.

Una serenata de mariachi es el regalo más romántico y tradicional. Con RegalosQueCantan, puedes crear una canción de mariachi personalizada que incluya el nombre de tu amor, un mensaje especial, y toda la emoción del género.`,
    artists: ['Vicente Fernández', 'Alejandro Fernández', 'Pedro Infante', 'Pepe Aguilar'],
    color: '#1D4ED8',
    icon: '🎺',
    popularFor: ['Serenatas', 'Día de las Madres', 'Aniversarios', 'Propuestas de matrimonio'],
    reviewCount: 187,
    featured: true,
    faqs: [
      { question: '¿Puedo usar la canción como serenata?', answer: 'Absolutamente. El mariachi es el género de serenata por excelencia. Tu canción personalizada puede reproducirse como serenata digital o acompañar a un mariachi en vivo.' },
      { question: '¿Suena como un mariachi real?', answer: 'Sí, nuestra IA genera música con trompetas, violines y guitarrón que captura la esencia del mariachi tradicional. La producción es de calidad profesional.' },
      ...DEFAULT_GENRE_FAQS
    ]
  },

  'bachata': {
    id: 'bachata',
    name: 'Bachata',
    slug: 'bachata',
    title: 'Bachata Personalizada con IA',
    metaDescription: 'Crea una bachata romántica personalizada con IA. Estilo Romeo Santos, Prince Royce. Guitarra y ritmo sensual con tu mensaje de amor. Desde $29.99.',
    keywords: 'bachata, romeo santos, prince royce, bachata romántica, canción de amor, aventura',
    heroTitle: 'Bachata Personalizada',
    heroSubtitle: 'El ritmo más romántico con tu declaración de amor',
    description: 'La bachata es el género del amor y el desamor. Guitarra requinteada, bongos y letras que enamoran.',
    definitionBlock: 'Una bachata personalizada es una canción romántica original con guitarra requinteada y bongos, creada con IA al estilo de Romeo Santos y Prince Royce. Incluye el nombre de tu persona especial y un mensaje de amor único, perfecta para San Valentín, aniversarios y declaraciones de amor. Lista en minutos desde $29.99.',
    longDescription: `La bachata nació en República Dominicana y conquistó el mundo con su ritmo sensual y sus letras románticas. Artistas como Romeo Santos y Prince Royce han llevado el género a los charts internacionales.

Una bachata personalizada es el regalo perfecto para esa persona especial. Incluye su nombre, menciona momentos especiales de su relación, y créale una canción de amor que nunca olvidará.`,
    artists: ['Romeo Santos', 'Prince Royce', 'Aventura', 'Juan Luis Guerra'],
    color: '#BE185D',
    icon: '💕',
    popularFor: ['San Valentín', 'Aniversarios', 'Declaraciones de amor', 'Propuestas'],
    reviewCount: 143,
    featured: true,
    demoAudio: '/sample-romantica-1.mp3',
    faqs: [
      { question: '¿Cómo suena una bachata personalizada?', answer: 'Suena como Romeo Santos o Prince Royce — guitarra requinteada, bongos y ritmo sensual — pero con una letra de amor escrita específicamente para tu persona especial.' },
      { question: '¿Es un buen regalo romántico?', answer: 'La bachata es el género romántico por excelencia. Una bachata con el nombre de tu pareja es uno de los regalos más emotivos que puedes dar.' },
      ...DEFAULT_GENRE_FAQS
    ]
  },

  'reggaeton': {
    id: 'reggaeton',
    name: 'Reggaeton',
    slug: 'reggaeton',
    title: 'Reggaeton Personalizado con IA',
    metaDescription: 'Crea un reggaeton personalizado con IA. Perreo, dembow y letras únicas con el nombre de tu persona especial. Desde $29.99.',
    keywords: 'reggaeton, perreo, dembow, bad bunny, daddy yankee, canción urbana',
    heroTitle: 'Reggaeton Personalizado',
    heroSubtitle: 'El beat que domina las fiestas con tu flow',
    description: 'El reggaeton es el género urbano latino por excelencia. Dembow, perreo y letras que ponen a bailar a todos.',
    definitionBlock: 'Un reggaeton personalizado es una canción urbana original con dembow y beats de perreo, creada con IA al estilo de Bad Bunny y Daddy Yankee. Incluye el nombre de tu persona especial con letras únicas, ideal para cumpleaños, fiestas y despedidas. Lista en minutos desde $29.99.',
    artists: ['Bad Bunny', 'Daddy Yankee', 'J Balvin', 'Karol G'],
    color: '#7C3AED',
    icon: '🔥',
    popularFor: ['Cumpleaños', 'Fiestas', 'Despedidas de soltero/a'],
    reviewCount: 94
  },
  
  'salsa': {
    id: 'salsa',
    name: 'Salsa',
    slug: 'salsa',
    title: 'Salsa Personalizada con IA',
    metaDescription: 'Crea una salsa personalizada con IA. Trompetas, piano y sabor caribeño. Estilo Marc Anthony, Héctor Lavoe. Desde $29.99.',
    keywords: 'salsa, marc anthony, héctor lavoe, celia cruz, salsa romántica, salsa dura',
    heroTitle: 'Salsa Personalizada',
    heroSubtitle: 'El sabor del Caribe con tu mensaje especial',
    description: 'La salsa es fuego caribeño. Trompetas, piano, y ese swing que hace imposible quedarse quieto.',
    definitionBlock: 'Una salsa personalizada es una canción caribeña original con trompetas, piano y timbales, creada con IA al estilo de Marc Anthony y Héctor Lavoe. Incluye el nombre de tu ser querido y un mensaje especial, perfecta para bodas, aniversarios y fiestas. Lista en minutos desde $29.99.',
    artists: ['Marc Anthony', 'Héctor Lavoe', 'Celia Cruz', 'Rubén Blades'],
    color: '#EA580C',
    icon: '🌴',
    popularFor: ['Bodas', 'Aniversarios', 'Fiestas caribeñas'],
    reviewCount: 76
  },
  
  'bolero': {
    id: 'bolero',
    name: 'Bolero',
    slug: 'bolero',
    title: 'Bolero Romántico Personalizado',
    metaDescription: 'Crea un bolero romántico personalizado con IA. El género más romántico con guitarras y letras poéticas. Desde $29.99.',
    keywords: 'bolero, bolero romántico, luis miguel, trio los panchos, canción romántica clásica',
    heroTitle: 'Bolero Personalizado',
    heroSubtitle: 'El romanticismo clásico con tu poesía de amor',
    description: 'El bolero es poesía hecha música. Guitarras, voces aterciopeladas y letras que derriten corazones.',
    definitionBlock: 'Un bolero personalizado es una canción romántica clásica con guitarras suaves y voces aterciopeladas, creada con IA al estilo de Luis Miguel y Trío Los Panchos. Incluye el nombre de tu ser querido con letras poéticas de amor, ideal para aniversarios, Día de las Madres y San Valentín. Desde $29.99.',
    artists: ['Luis Miguel', 'Trío Los Panchos', 'Armando Manzanero'],
    color: '#991B1B',
    icon: '🌹',
    popularFor: ['Aniversarios', 'Propuestas', 'Día de las Madres', 'San Valentín'],
    reviewCount: 89,
    demoAudio: '/sample-romantica-2.mp3',
    faqs: [
      { question: '¿Cómo suena un bolero personalizado?', answer: 'Suena como las canciones de Luis Miguel o Trío Los Panchos — guitarras suaves, voces aterciopeladas y letras poéticas — pero con un mensaje escrito solo para tu ser querido.' },
      { question: '¿Es apropiado para personas mayores?', answer: 'El bolero es perfecto para cualquier edad, pero es especialmente apreciado por personas que crecieron con este género romántico clásico. Es un regalo elegante y emotivo.' },
      ...DEFAULT_GENRE_FAQS
    ]
  },

  'ranchera': {
    id: 'ranchera',
    name: 'Ranchera',
    slug: 'ranchera',
    title: 'Ranchera Personalizada con IA',
    metaDescription: 'Crea una ranchera personalizada con IA. El género tradicional mexicano con mariachi. Estilo José Alfredo Jiménez. Desde $29.99.',
    keywords: 'ranchera, josé alfredo jiménez, canción mexicana, música tradicional, ranchera con mariachi',
    heroTitle: 'Ranchera Personalizada',
    heroSubtitle: 'La canción mexicana por excelencia con tu sentimiento',
    description: 'La ranchera es el alma de México. Canciones de amor, desamor y orgullo mexicano.',
    definitionBlock: 'Una ranchera personalizada es una canción mexicana tradicional creada con IA al estilo de José Alfredo Jiménez y Pedro Infante. Con mariachi, guitarra y sentimiento mexicano, incluye el nombre de tu ser querido y un mensaje de amor, orgullo o gratitud. Perfecta para el Día de las Madres y fiestas patrias. Desde $29.99.',
    artists: ['José Alfredo Jiménez', 'Pedro Infante', 'Javier Solís', 'Antonio Aguilar'],
    color: '#166534',
    icon: '🇲🇽',
    popularFor: ['Día de las Madres', 'Día del Padre', '15 de Septiembre', 'Homenajes'],
    reviewCount: 112
  },
  
  'regional-mexicano': {
    id: 'regional-mexicano',
    name: 'Regional Mexicano',
    slug: 'regional-mexicano',
    title: 'Regional Mexicano Personalizado',
    metaDescription: 'Crea una canción de regional mexicano personalizada con IA. Mezcla de géneros tradicionales mexicanos. Desde $29.99.',
    keywords: 'regional mexicano, música mexicana, canción personalizada mexicana',
    heroTitle: 'Regional Mexicano Personalizado',
    heroSubtitle: 'Lo mejor de la música mexicana en una canción',
    description: 'El regional mexicano abarca lo mejor de la música tradicional de México. Una fusión de sonidos auténticos.',
    definitionBlock: 'Una canción de regional mexicano personalizada fusiona los mejores estilos de la música mexicana — norteño, banda y sierreño — creada con IA al estilo de Christian Nodal y Calibre 50. Incluye el nombre de tu ser querido, perfecta para cualquier celebración familiar. Lista en minutos desde $29.99.',
    artists: ['Christian Nodal', 'Calibre 50', 'Gerardo Ortiz'],
    color: '#B45309',
    icon: '🎵',
    popularFor: ['Todas las ocasiones', 'Fiestas mexicanas', 'Celebraciones familiares'],
    reviewCount: 134
  },
  
  'pop-latino': {
    id: 'pop-latino',
    name: 'Pop Latino',
    slug: 'pop-latino',
    title: 'Pop Latino Personalizado',
    metaDescription: 'Crea una canción de pop latino personalizada con IA. Estilo Luis Fonsi, Shakira. Moderno y pegajoso. Desde $29.99.',
    keywords: 'pop latino, luis fonsi, shakira, enrique iglesias, canción pop en español',
    heroTitle: 'Pop Latino Personalizado',
    heroSubtitle: 'El sonido moderno latino con tu mensaje',
    description: 'El pop latino combina ritmos latinos con producción moderna. Pegajoso, bailable y perfecto para cualquier edad.',
    definitionBlock: 'Una canción de pop latino personalizada combina ritmos latinos con producción moderna, creada con IA al estilo de Shakira y Luis Fonsi. Pegajosa y bailable, incluye el nombre de tu ser querido con un mensaje especial. Ideal para cumpleaños, graduaciones y quinceañeras. Desde $29.99.',
    artists: ['Luis Fonsi', 'Shakira', 'Enrique Iglesias', 'Thalía'],
    color: '#0891B2',
    icon: '🎤',
    popularFor: ['Cumpleaños', 'Graduaciones', 'Quinceañeras'],
    reviewCount: 67
  },
  
  'balada': {
    id: 'balada',
    name: 'Balada',
    slug: 'balada',
    title: 'Balada Romántica Personalizada',
    metaDescription: 'Crea una balada romántica personalizada con IA. Letras emotivas y melodías que llegan al corazón. Desde $29.99.',
    keywords: 'balada romántica, balada en español, canción romántica, alejandro sanz',
    heroTitle: 'Balada Personalizada',
    heroSubtitle: 'Emociones profundas en una canción única',
    description: 'La balada es emoción pura. Letras profundas, melodías emotivas y un mensaje que toca el corazón.',
    definitionBlock: 'Una balada personalizada es una canción emotiva con melodías profundas y letras que tocan el corazón, creada con IA al estilo de Alejandro Sanz y Sin Bandera. Incluye el nombre de tu ser querido y un mensaje personal, perfecta para aniversarios, declaraciones de amor y momentos especiales. Desde $29.99.',
    artists: ['Alejandro Sanz', 'Laura Pausini', 'Ricardo Arjona', 'Sin Bandera'],
    color: '#4F46E5',
    icon: '💜',
    popularFor: ['Aniversarios', 'Declaraciones', 'Momentos especiales'],
    reviewCount: 78
  },
  
  'vallenato': {
    id: 'vallenato',
    name: 'Vallenato',
    slug: 'vallenato',
    title: 'Vallenato Personalizado con IA',
    metaDescription: 'Crea un vallenato personalizado con IA. Acordeón, caja y guacharaca. El sonido de Colombia con tu mensaje. Desde $29.99.',
    keywords: 'vallenato, carlos vives, diomedes díaz, acordeón vallenato, música colombiana',
    heroTitle: 'Vallenato Personalizado',
    heroSubtitle: 'El acordeón colombiano con tu historia de amor',
    description: 'El vallenato es el orgullo de Colombia. Acordeón, caja y guacharaca para contar historias de amor.',
    definitionBlock: 'Un vallenato personalizado es una canción colombiana original con acordeón, caja y guacharaca, creada con IA al estilo de Carlos Vives y Diomedes Díaz. Incluye el nombre de tu ser querido y cuenta tu historia de amor con el sabor auténtico de Colombia. Ideal para declaraciones y cumpleaños. Desde $29.99.',
    artists: ['Carlos Vives', 'Diomedes Díaz', 'Silvestre Dangond'],
    color: '#15803D',
    icon: '🪗',
    popularFor: ['Declaraciones de amor', 'Bodas', 'Cumpleaños'],
    reviewCount: 43
  },
  
  'merengue': {
    id: 'merengue',
    name: 'Merengue',
    slug: 'merengue',
    title: 'Merengue Personalizado con IA',
    metaDescription: 'Crea un merengue personalizado con IA. El ritmo más rápido y alegre del Caribe con tu mensaje especial. Desde $29.99.',
    keywords: 'merengue, juan luis guerra, los hermanos rosario, música dominicana',
    heroTitle: 'Merengue Personalizado',
    heroSubtitle: 'El ritmo más alegre con tu celebración',
    description: 'El merengue es pura alegría. Ritmo rápido, acordeón y güira para una fiesta inolvidable.',
    definitionBlock: 'Un merengue personalizado es una canción dominicana rápida y alegre con acordeón, güira y tambora, creada con IA al estilo de Juan Luis Guerra y Los Hermanos Rosario. Incluye el nombre de tu ser querido para una celebración llena de energía. Perfecta para fiestas y cumpleaños. Desde $29.99.',
    artists: ['Juan Luis Guerra', 'Los Hermanos Rosario', 'Eddy Herrera'],
    color: '#DC2626',
    icon: '🎉',
    popularFor: ['Fiestas', 'Cumpleaños', 'Bodas caribeñas'],
    reviewCount: 34
  },
  
  'huapango': {
    id: 'huapango',
    name: 'Huapango',
    slug: 'huapango',
    title: 'Huapango Personalizado',
    metaDescription: 'Crea un huapango personalizado con IA. El son huasteco con violín, jarana y guitarra quinta. Tradición mexicana. Desde $29.99.',
    keywords: 'huapango, son huasteco, música tradicional mexicana, huapango arribeño',
    heroTitle: 'Huapango Personalizado',
    heroSubtitle: 'El son huasteco con tu mensaje especial',
    description: 'El huapango es tradición pura de la Huasteca mexicana. Violín, jarana y guitarra quinta.',
    definitionBlock: 'Un huapango personalizado es una canción del son huasteco con violín, jarana y guitarra quinta, creada con IA honrando la tradición de la Huasteca mexicana. Incluye el nombre de tu ser querido en un regalo musical auténtico, perfecto para fiestas tradicionales, bodas y homenajes culturales. Desde $29.99.',
    artists: ['Los Camperos de Valles', 'Trío Xoxocapa'],
    color: '#A16207',
    icon: '🎻',
    popularFor: ['Fiestas tradicionales', 'Bodas rurales', 'Homenajes'],
    reviewCount: 23
  },
  
  'son-jarocho': {
    id: 'son-jarocho',
    name: 'Son Jarocho',
    slug: 'son-jarocho',
    title: 'Son Jarocho Personalizado',
    metaDescription: 'Crea un son jarocho personalizado con IA. La música tradicional de Veracruz con arpa, jarana y requinto. Desde $29.99.',
    keywords: 'son jarocho, música veracruzana, la bamba, arpa jarocha, fandango',
    heroTitle: 'Son Jarocho Personalizado',
    heroSubtitle: 'El ritmo de Veracruz con tu celebración',
    description: 'El son jarocho es el alma de Veracruz. Arpa, jarana y requinto para un fandango inolvidable.',
    definitionBlock: 'Un son jarocho personalizado es una canción veracruzana original con arpa, jarana y requinto, creada con IA en la tradición del fandango. Incluye el nombre de tu ser querido para un regalo musical que celebra la cultura de Veracruz. Ideal para bodas, fiestas y celebraciones culturales. Desde $29.99.',
    artists: ['Mono Blanco', 'Los Cojolites', 'Son de Madera'],
    color: '#0D9488',
    icon: '🌊',
    popularFor: ['Bodas veracruzanas', 'Fiestas tradicionales', 'Celebraciones culturales'],
    reviewCount: 19
  }
};

// ============================================
// OCCASIONS DATA
// ============================================
export const OCCASIONS_SEO = {
  'cumpleanos': {
    id: 'cumpleanos',
    name: 'Cumpleaños',
    slug: 'cumpleanos',
    title: 'Canciones de Cumpleaños Personalizadas',
    metaDescription: 'Regala una canción de cumpleaños única con el nombre del festejado. Más especial que "Las Mañanitas". En corridos, cumbia, banda y más géneros. Desde $29.99.',
    keywords: 'canción de cumpleaños, regalo cumpleaños original, las mañanitas personalizada, cumpleaños único, regalo musical cumpleaños',
    heroTitle: 'Canciones de Cumpleaños Personalizadas',
    heroSubtitle: 'Más especial que "Las Mañanitas" — Una canción solo para ellos',
    description: 'Olvídate de las mañanitas genéricas. Crea una canción de cumpleaños única que mencione el nombre del festejado, su edad, y todo lo que lo hace especial.',
    definitionBlock: 'Una canción de cumpleaños personalizada es un regalo musical original creado con IA que incluye el nombre del festejado, su edad y detalles especiales. Disponible en cumbia, banda, corridos tumbados y más géneros latinos, es mucho más especial que "Las Mañanitas" genéricas. Lista en minutos desde $29.99.',
    longDescription: `Todos merecen una canción de cumpleaños especial. No una genérica que cantan millones, sino una creada específicamente para ellos.

Con RegalosQueCantan, creas una canción de cumpleaños personalizada que incluye:
• El nombre del festejado
• Su edad (si quieres)
• Menciones de lo que los hace especiales
• El género musical que más les gusta

Imagina la cara de sorpresa cuando escuchen su nombre en una canción profesional. Es el regalo que nunca olvidarán.`,
    icon: '🎂',
    color: '#F59E0B',
    suggestedGenres: ['cumbia', 'banda-sinaloense', 'corridos-tumbados', 'reggaeton', 'mariachi'],
    ageGroups: ['Niños', 'Adolescentes', 'Adultos', 'Adultos mayores'],
    reviewCount: 234,
    featured: true,
    faqs: [
      { question: '¿Puedo incluir la edad del festejado en la canción?', answer: 'Sí, puedes incluir su edad, nombre, apodo y cualquier detalle especial. La canción mencionará todo lo que tú quieras para hacerla única.' },
      { question: '¿Es mejor que las mañanitas tradicionales?', answer: 'Es mil veces mejor. Las mañanitas las cantan millones. Tu canción personalizada solo existe para esa persona especial, con su nombre y detalles únicos.' },
      ...DEFAULT_OCCASION_FAQS
    ]
  },

  'dia-de-las-madres': {
    id: 'dia-de-las-madres',
    name: 'Día de las Madres',
    slug: 'dia-de-las-madres',
    title: 'Canciones para el Día de las Madres',
    metaDescription: 'Regala a mamá una canción personalizada este 10 de Mayo. Con su nombre y todo tu amor. En mariachi, bolero, ranchera o el género que ella prefiera. Desde $29.99.',
    keywords: 'regalo día de las madres, canción para mamá, 10 de mayo regalo, regalo original mamá, serenata día de las madres',
    heroTitle: 'Canciones para el Día de las Madres',
    heroSubtitle: 'El regalo que mamá merece — Una canción solo para ella',
    description: 'Mamá merece más que flores. Regálale una canción que mencione su nombre, lo maravillosa que es, y todo el amor que sientes por ella.',
    definitionBlock: 'Una canción para el Día de las Madres personalizada es un regalo musical creado con IA que incluye el nombre de mamá y un mensaje de amor único. Disponible en mariachi, bolero, ranchera y más géneros, es el regalo perfecto para el 10 de Mayo que mamá nunca olvidará. Lista en minutos desde $29.99.',
    longDescription: `El Día de las Madres es la fecha más importante para las familias latinas. Mamá merece un regalo que realmente exprese cuánto la amas.

Una canción personalizada para mamá incluye:
• Su nombre y cómo la llamas cariñosamente
• Agradecimientos por todo lo que ha hecho
• Memorias especiales que comparten
• Todo tu amor expresado en música

Ya sea mariachi tradicional, bolero romántico, o el género que ella prefiera, creamos la canción perfecta para tu mamá.`,
    icon: '👩‍👧',
    color: '#EC4899',
    suggestedGenres: ['mariachi', 'bolero', 'ranchera', 'balada', 'norteno'],
    reviewCount: 312,
    featured: true,
    seasonal: true,
    peakMonth: 5,
    faqs: [
      { question: '¿Puedo mencionar cómo le digo a mi mamá cariñosamente?', answer: 'Claro que sí. Puedes incluir apodos como "mami", "jefa", "madre" o cualquier nombre cariñoso. La canción lo incorporará de forma natural.' },
      { question: '¿Es un buen regalo de último minuto para el 10 de Mayo?', answer: 'Perfecto para último minuto. Tu canción estará lista en 2-4 minutos. Puedes crearla el mismo día y enviársela por WhatsApp al instante.' },
      ...DEFAULT_OCCASION_FAQS
    ]
  },

  'dia-del-padre': {
    id: 'dia-del-padre',
    name: 'Día del Padre',
    slug: 'dia-del-padre',
    title: 'Canciones para el Día del Padre',
    metaDescription: 'Sorprende a papá con una canción personalizada. Corrido, norteño o banda con su nombre y tu agradecimiento. El regalo perfecto. Desde $29.99.',
    keywords: 'regalo día del padre, canción para papá, regalo original papá, día del padre único',
    heroTitle: 'Canciones para el Día del Padre',
    heroSubtitle: 'Un regalo que papá nunca esperaría',
    description: 'Papá siempre da todo por la familia. Sorpréndelo con una canción que cuente su historia y le agradezca por todo.',
    definitionBlock: 'Una canción para el Día del Padre personalizada es un regalo musical creado con IA que menciona el nombre de papá, sus logros y tu agradecimiento. En corrido, norteño, banda o el género que él prefiera, es la sorpresa que papá nunca esperaría. Lista en minutos desde $29.99.',
    longDescription: `Papá es difícil de sorprender. Ya tiene todo lo que necesita. Pero una canción personalizada es algo que nunca esperaría.

Crea un corrido que cuente sus logros, una ranchera que exprese tu admiración, o una banda que lo haga sonreír. El género que él prefiera, con su nombre y un mensaje de tu corazón.`,
    icon: '👨‍👧',
    color: '#2563EB',
    suggestedGenres: ['corridos-tumbados', 'corrido-clasico', 'norteno', 'banda-sinaloense', 'ranchera'],
    reviewCount: 156,
    featured: true,
    seasonal: true,
    peakMonth: 6,
    faqs: [
      { question: '¿Puedo mencionar los logros de mi papá?', answer: 'Sí, puedes incluir sus logros profesionales, hobbies, sacrificios y todo lo que admiras de él. La canción contará su historia.' },
      ...DEFAULT_OCCASION_FAQS
    ]
  },

  'aniversario': {
    id: 'aniversario',
    name: 'Aniversario',
    slug: 'aniversario',
    title: 'Canciones de Aniversario Personalizadas',
    metaDescription: 'Celebra su aniversario con una canción única. Romance, memorias y promesas de amor en bachata, bolero o el género que prefieran. Desde $29.99.',
    keywords: 'canción aniversario, regalo aniversario romántico, canción de amor personalizada, aniversario de bodas',
    heroTitle: 'Canciones de Aniversario',
    heroSubtitle: 'Celebra su amor con una canción que cuente su historia',
    description: 'Cada aniversario merece ser especial. Crea una canción que mencione cómo se conocieron, momentos especiales, y el amor que siguen compartiendo.',
    definitionBlock: 'Una canción de aniversario personalizada es un regalo romántico creado con IA que cuenta la historia de amor de la pareja. Incluye los nombres de ambos, cómo se conocieron y promesas de amor, en bachata, bolero o el género que defina su relación. Lista en minutos desde $29.99.',
    longDescription: `Un aniversario es la celebración de su historia de amor. ¿Qué mejor regalo que una canción que cuente esa historia?

Tu canción de aniversario puede incluir:
• Cómo se conocieron
• Momentos especiales que han vivido
• Los nombres de ambos
• Promesas de amor eterno

En bachata romántica, bolero clásico, o el género que marque su relación.`,
    icon: '💑',
    color: '#DC2626',
    suggestedGenres: ['bachata', 'bolero', 'balada', 'salsa', 'mariachi'],
    reviewCount: 189,
    featured: true,
    faqs: [
      { question: '¿Puedo incluir cómo nos conocimos?', answer: 'Sí, puedes incluir la historia de cómo se conocieron, momentos especiales, fechas importantes y cualquier detalle que haga la canción única para su relación.' },
      ...DEFAULT_OCCASION_FAQS
    ]
  },

  'boda': {
    id: 'boda',
    name: 'Boda',
    slug: 'boda',
    title: 'Canciones para Bodas Personalizadas',
    metaDescription: 'Haz su boda inolvidable con una canción personalizada. Primer baile único con sus nombres y historia de amor. Desde $29.99.',
    keywords: 'canción para boda, primer baile boda, canción novios, regalo boda único, vals personalizado',
    heroTitle: 'Canciones para Bodas',
    heroSubtitle: 'El primer baile que nadie más tendrá',
    description: 'Su boda merece una canción única. Crea la canción perfecta para el primer baile con sus nombres y su historia de amor.',
    definitionBlock: 'Una canción de boda personalizada es una pieza musical única creada con IA para el primer baile de los novios. Incluye los nombres de la pareja y su historia de amor, en bachata, bolero, cumbia o vals. Es el primer baile que ninguna otra pareja tendrá. Lista en minutos desde $29.99.',
    longDescription: `El primer baile es uno de los momentos más especiales de una boda. Imagina bailarlo con una canción creada específicamente para ustedes.

Una canción de boda personalizada incluye:
• Los nombres de ambos
• Su historia de amor
• Votos y promesas
• El género musical que define su relación

Ya sea un vals romántico, una cumbia para que todos bailen, o una bachata sensual — la canción será solo suya.`,
    icon: '💒',
    color: '#F472B6',
    suggestedGenres: ['bachata', 'balada', 'bolero', 'cumbia', 'mariachi'],
    reviewCount: 98,
    featured: true,
    faqs: [
      { question: '¿Puedo usarla como primer baile?', answer: 'Absolutamente. Muchas parejas usan nuestra canción personalizada como primer baile. Es una canción única que solo ustedes tendrán.' },
      ...DEFAULT_OCCASION_FAQS
    ]
  },

  'quinceanera': {
    id: 'quinceanera',
    name: 'Quinceañera',
    slug: 'quinceanera',
    title: 'Canciones para Quinceañeras',
    metaDescription: 'Haz sus XV años inolvidables con una canción personalizada. Vals único con su nombre. El regalo perfecto para la quinceañera. Desde $29.99.',
    keywords: 'canción quinceañera, vals xv años, regalo quinceañera, quince años canción',
    heroTitle: 'Canciones para Quinceañeras',
    heroSubtitle: 'El vals que la convertirá en mujer será único',
    description: 'Los XV años son un momento único en la vida. Regálale una canción personalizada para su vals que nunca olvidará.',
    definitionBlock: 'Una canción de quinceañera personalizada es un vals único creado con IA que incluye el nombre de la festejada y deseos especiales para su nueva etapa. Disponible en balada, bachata, cumbia o mariachi, es el regalo perfecto para los XV años que ella nunca olvidará. Desde $29.99.',
    longDescription: `La quinceañera es una de las tradiciones más importantes para las familias latinas. El vals marca la transición de niña a mujer.

Una canción de XV años personalizada incluye:
• El nombre de la quinceañera
• Deseos y bendiciones para su futuro
• Mensajes de la familia
• El género que ella prefiera para su vals

Puede ser un vals tradicional, una cumbia para después, o incluso un reggaeton para la fiesta. Todo personalizado para ella.`,
    icon: '👸',
    color: '#A855F7',
    suggestedGenres: ['balada', 'bachata', 'cumbia', 'pop-latino', 'mariachi'],
    reviewCount: 87,
    featured: true,
    faqs: [
      { question: '¿Puedo usarla como vals de XV años?', answer: 'Sí, es perfecta como vals personalizado. La canción incluirá el nombre de la quinceañera y deseos especiales para su nueva etapa.' },
      ...DEFAULT_OCCASION_FAQS
    ]
  },

  'graduacion': {
    id: 'graduacion',
    name: 'Graduación',
    slug: 'graduacion',
    title: 'Canciones de Graduación Personalizadas',
    metaDescription: 'Celebra su graduación con una canción que reconozca su esfuerzo. Con su nombre, carrera y logros. Regalo único desde $29.99.',
    keywords: 'canción graduación, regalo graduación, felicitaciones graduado, canción logros',
    heroTitle: 'Canciones de Graduación',
    heroSubtitle: 'Celebra sus logros con una canción que los reconozca',
    description: 'La graduación marca el fin de una etapa y el inicio de otra. Celebra su esfuerzo con una canción que mencione sus logros.',
    definitionBlock: 'Una canción de graduación personalizada es un regalo musical creado con IA que celebra los logros del graduado. Incluye su nombre, carrera y un mensaje de orgullo, en corridos tumbados, cumbia, pop latino o banda. El reconocimiento que su esfuerzo merece, listo en minutos desde $29.99.',
    icon: '🎓',
    color: '#1D4ED8',
    suggestedGenres: ['corridos-tumbados', 'cumbia', 'pop-latino', 'banda-sinaloense'],
    reviewCount: 56
  },
  
  'san-valentin': {
    id: 'san-valentin',
    name: 'San Valentín',
    slug: 'san-valentin',
    title: 'Canciones de San Valentín',
    metaDescription: 'Regala la canción de amor perfecta este 14 de febrero. Bachata, bolero o balada personalizada con sus nombres. Desde $29.99.',
    keywords: 'regalo san valentín, canción 14 febrero, regalo romántico, canción de amor',
    heroTitle: 'Canciones de San Valentín',
    heroSubtitle: 'El regalo más romántico del 14 de febrero',
    description: 'San Valentín es para celebrar el amor. Regala una canción que exprese todo lo que sientes con palabras que nunca encontrarías.',
    definitionBlock: 'Una canción de San Valentín personalizada es el regalo romántico perfecto para el 14 de febrero, creado con IA. Incluye los nombres de la pareja y un mensaje de amor único, en bachata, bolero o balada. Más especial que flores o chocolates, lista en minutos desde $29.99.',
    icon: '❤️',
    color: '#E11D48',
    suggestedGenres: ['bachata', 'bolero', 'balada', 'salsa'],
    reviewCount: 123,
    seasonal: true,
    peakMonth: 2
  },
  
  'navidad': {
    id: 'navidad',
    name: 'Navidad',
    slug: 'navidad',
    title: 'Canciones Navideñas Personalizadas',
    metaDescription: 'Regala una canción navideña personalizada con los nombres de toda la familia. El villancico único para esta Navidad. Desde $29.99.',
    keywords: 'canción navidad personalizada, villancico personalizado, regalo navidad único, canción familia navidad',
    heroTitle: 'Canciones Navideñas',
    heroSubtitle: 'El villancico de tu familia para esta Navidad',
    description: 'Crea un villancico personalizado que mencione a toda la familia. El regalo navideño que guardarán para siempre.',
    definitionBlock: 'Una canción navideña personalizada es un villancico único creado con IA que menciona los nombres de toda la familia. En cumbia, pop latino, mariachi o balada, es el regalo de Navidad que guardarán para siempre y podrán escuchar cada diciembre. Desde $29.99.',
    icon: '🎄',
    color: '#15803D',
    suggestedGenres: ['cumbia', 'pop-latino', 'mariachi', 'balada'],
    reviewCount: 67,
    seasonal: true,
    peakMonth: 12
  },
  
  'declaracion-amor': {
    id: 'declaracion-amor',
    name: 'Declaración de Amor',
    slug: 'declaracion-amor',
    title: 'Canciones para Declarar tu Amor',
    metaDescription: 'Declara tu amor con una canción única. Bachata, bolero o balada con tu mensaje y el nombre de esa persona especial. Desde $29.99.',
    keywords: 'declaración de amor, canción para enamorar, propuesta amor, canción romántica',
    heroTitle: 'Canciones para Declarar tu Amor',
    heroSubtitle: 'Las palabras que tu corazón no puede expresar',
    description: 'A veces las palabras no son suficientes. Una canción personalizada dice todo lo que sientes de una forma que nunca olvidará.',
    definitionBlock: 'Una canción para declarar tu amor es una pieza musical romántica creada con IA que expresa tus sentimientos con el nombre de esa persona especial. En bachata, bolero, balada o mariachi, dice todo lo que tu corazón no puede expresar. Lista en minutos desde $29.99.',
    icon: '💌',
    color: '#DB2777',
    suggestedGenres: ['bachata', 'bolero', 'balada', 'norteno', 'mariachi'],
    reviewCount: 78
  },
  
  'despedida': {
    id: 'despedida',
    name: 'Despedida',
    slug: 'despedida',
    title: 'Canciones de Despedida',
    metaDescription: 'Despídete con una canción que exprese todo lo que no puedes decir. Para jubilaciones, mudanzas o adioses. Desde $29.99.',
    keywords: 'canción despedida, regalo despedida trabajo, canción jubilación, canción adiós',
    heroTitle: 'Canciones de Despedida',
    heroSubtitle: 'Cuando las palabras no son suficientes',
    description: 'Las despedidas son difíciles. Una canción personalizada expresa todo lo que significa esa persona para ti.',
    definitionBlock: 'Una canción de despedida personalizada es un regalo musical emotivo creado con IA que expresa todo lo que esa persona significa para ti. Para jubilaciones, mudanzas o adioses, en bolero, balada o norteño, incluye su nombre y un mensaje del corazón. Desde $29.99.',
    icon: '👋',
    color: '#64748B',
    suggestedGenres: ['bolero', 'balada', 'norteno', 'ranchera'],
    reviewCount: 34
  },
  
  'agradecimiento': {
    id: 'agradecimiento',
    name: 'Agradecimiento',
    slug: 'agradecimiento',
    title: 'Canciones de Agradecimiento',
    metaDescription: 'Da las gracias de forma inolvidable con una canción personalizada. Para maestros, mentores o cualquier persona especial. Desde $29.99.',
    keywords: 'canción agradecimiento, regalo gracias, canción para maestro, agradecimiento único',
    heroTitle: 'Canciones de Agradecimiento',
    heroSubtitle: 'Un gracias que nunca olvidarán',
    description: 'Algunas personas merecen más que un simple "gracias". Una canción personalizada muestra cuánto aprecias todo lo que han hecho.',
    definitionBlock: 'Una canción de agradecimiento personalizada es un regalo musical creado con IA que expresa tu gratitud de forma inolvidable. Incluye el nombre de esa persona especial — maestro, mentor o amigo — y un mensaje de agradecimiento en bolero, balada, mariachi o cumbia. Desde $29.99.',
    icon: '🙏',
    color: '#0891B2',
    suggestedGenres: ['bolero', 'balada', 'mariachi', 'cumbia'],
    reviewCount: 45
  }
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get all genres as array
 */
export const getAllGenres = () => Object.values(GENRES_SEO);

/**
 * Get all occasions as array
 */
export const getAllOccasions = () => Object.values(OCCASIONS_SEO);

/**
 * Get featured genres
 */
export const getFeaturedGenres = () => getAllGenres().filter(g => g.featured);

/**
 * Get featured occasions
 */
export const getFeaturedOccasions = () => getAllOccasions().filter(o => o.featured);

/**
 * Get genre by slug
 */
export const getGenreBySlug = (slug) => GENRES_SEO[slug] || null;

/**
 * Get occasion by slug
 */
export const getOccasionBySlug = (slug) => OCCASIONS_SEO[slug] || null;

/**
 * Get seasonal occasions for current month
 */
export const getCurrentSeasonalOccasions = () => {
  const currentMonth = new Date().getMonth() + 1;
  return getAllOccasions().filter(o => o.seasonal && o.peakMonth === currentMonth);
};
