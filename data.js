/* Datos de ejemplo compartidos por index.html y watch.html.
   Reemplázalos por tu backend (fetch('/api/videos')) cuando lo tengas.
   src: lista de fuentes del video. embed = URL para insertar en el reproductor; dl = enlace de descarga. */
const VIDEOS = [
  {
    title: 'Cómo editar tu primer video en 15 minutos',
    ch: 'Taller Creativo', dur: '12:34', when: 'hace un día', coms: 155,
    cat: 'Tutorial', year: 2026, views: '1,2 M',
    tags: ['Edición', 'Principiantes', 'Software'],
    desc: 'Un recorrido paso a paso por el proceso de edición: importar el material, ordenar las tomas, cortar con ritmo, agregar música y exportar el resultado final. Pensado para quien nunca ha abierto un editor de video y quiere terminar su primer proyecto hoy mismo, sin instalar nada extra.',
    rating: '8.73', votes: '1,204',
    src: [{
      n: 'Mega',
      embed: 'https://mega.nz/embed/MnoChCpQ#S63JRkBV3kcc90w1aQnsEMjohfR6aaIHbbY-ieNnnmc',
      dl: 'https://mega.nz/file/MnoChCpQ#S63JRkBV3kcc90w1aQnsEMjohfR6aaIHbbY-ieNnnmc'
    }]
  },
  {
    title: 'Guía real para fotografiar de noche',
    ch: 'Lente Abierto', dur: '08:12', when: 'hace 3 días', coms: 48,
    cat: 'Tutorial', year: 2026, views: '640 mil',
    tags: ['Fotografía', 'Noche'],
    desc: 'Ajustes de cámara, trípode, enfoque manual y edición básica para conseguir fotos nítidas con poca luz, tanto con cámara como con el teléfono.',
    rating: '8.10', votes: '532', src: []
  },
  {
    title: 'Probamos 5 micrófonos económicos',
    ch: 'Audio Lab', dur: '21:07', when: 'hace 3 días', coms: 212,
    cat: 'Reseña', year: 2026, views: '980 mil',
    tags: ['Audio', 'Equipo', 'Comparativa'],
    desc: 'Grabamos la misma frase con cinco micrófonos de menos de 50 dólares, en la misma habitación y con los mismos ajustes, para que puedas escuchar la diferencia real.',
    rating: '8.55', votes: '2,310', src: []
  },
  {
    title: 'Historia corta de los videojuegos',
    ch: 'Pixel Archivo', dur: '17:45', when: 'hace 4 días', coms: 96,
    cat: 'Documental', year: 2025, views: '870 mil',
    tags: ['Juegos', 'Historia'],
    desc: 'De los primeros experimentos en laboratorios a las consolas modernas: los momentos y las personas que definieron cómo jugamos hoy.',
    rating: '9.01', votes: '1,876', src: []
  },
  {
    title: 'Aprende guitarra con tres acordes',
    ch: 'Casa de Música', dur: '10:02', when: 'hace 5 días', coms: 73,
    cat: 'Tutorial', year: 2026, views: '512 mil',
    tags: ['Música', 'Guitarra', 'Principiantes'],
    desc: 'Tres acordes, un ritmo sencillo y cuatro canciones para practicar. Sin teoría complicada: solo manos a la obra desde el primer minuto.',
    rating: '8.32', votes: '744', src: []
  },
  {
    title: 'Un día en un taller de cerámica',
    ch: 'Manos a la obra', dur: '06:58', when: 'hace 6 días', coms: 31,
    cat: 'Vlog', year: 2026, views: '210 mil',
    tags: ['Artesanía', 'Cerámica'],
    desc: 'Acompañamos a una ceramista durante una jornada completa: del barro crudo al horno, sin prisa y sin música de fondo.',
    rating: '8.88', votes: '298', src: []
  },
  {
    title: 'Por qué se hunden las ciudades',
    ch: 'Mapa Mundi', dur: '14:20', when: 'hace una semana', coms: 184,
    cat: 'Documental', year: 2026, views: '1,5 M',
    tags: ['Ciencia', 'Ciudades'],
    desc: 'El suelo bajo algunas de las grandes ciudades del mundo está descendiendo. Revisamos las causas, los datos y lo que se está haciendo al respecto.',
    rating: '9.12', votes: '3,402', src: []
  },
  {
    title: 'Montaje de un estudio en casa',
    ch: 'Taller Creativo', dur: '19:33', when: 'hace una semana', coms: 129,
    cat: 'Vlog', year: 2025, views: '430 mil',
    tags: ['Estudio', 'Equipo', 'Tutorial'],
    desc: 'Cómo transformamos una habitación vacía en un estudio de grabación funcional: acústica, iluminación, cableado y presupuesto final.',
    rating: '8.46', votes: '615', src: []
  }
];

/* Degradado de relleno para miniaturas sin imagen (si el video trae `thumb`, se usa esa imagen) */
const vidloHues = [262, 215, 160, 20, 330, 190, 45, 290];
function vidloArt(i, ang = 135) {
  const h = vidloHues[i % vidloHues.length];
  return `background:linear-gradient(${ang}deg,hsl(${h} 70% 45%),hsl(${(h + 50) % 360} 75% 28%) 60%,hsl(${(h + 90) % 360} 60% 15%))`;
}
