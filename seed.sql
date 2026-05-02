-- ================================================================
-- PrestaLink — Seed Data
-- Run: mysql -u root -p prestalink < seed.sql
-- ================================================================

-- Provider Types (skip if already exist)
INSERT IGNORE INTO provider_types (name, slug, description, discount_percentage, icon, meta_title, meta_description) VALUES
('Photographes',    'photographes',    'Photographes et vidéastes professionnels pour vos événements', 10, 'camera',    'Photographes événementiels Tunisie | PrestaLink', 'Trouvez les meilleurs photographes de mariage en Tunisie'),
('Traiteurs',       'traiteurs',       'Traiteurs et chefs cuisiniers pour vos réceptions',            12, 'chef-hat',  'Traiteurs mariage Tunisie | PrestaLink',            'Les meilleurs traiteurs pour vos mariages en Tunisie'),
('Décorateurs',     'decorateurs',     'Décorateurs et stylistes pour sublimer vos événements',        8,  'palette',   'Décorateurs événementiels Tunisie | PrestaLink',   'Décorateurs de mariage professionnels en Tunisie'),
('Animateurs',      'animateurs',      'DJ, orchestres et animateurs pour vos fêtes',                  10, 'music',     'Animateurs mariage Tunisie | PrestaLink',           'Animateurs et DJ professionnels pour vos événements'),
('Fleuristes',      'fleuristes',      'Fleuristes spécialisés en décoration florale événementielle',  8,  'flower',    'Fleuristes mariage Tunisie | PrestaLink',           'Bouquets et décorations florales pour mariages'),
('Salles de Fêtes', 'locations-salles','Salles de réception et espaces événementiels',                 5,  'building',  'Salles de fêtes Tunisie | PrestaLink',              'Location de salles de fêtes et espaces événementiels');

-- ----------------------------------------------------------------
-- Photographes
-- ----------------------------------------------------------------
INSERT INTO providers (type_id, name, slug, short_description, description, email, phone, city, governorate, price_min, price_max, is_featured, is_active, rating, meta_title, meta_description) VALUES
((SELECT id FROM provider_types WHERE slug='photographes'),
 'Adem Photographe', 'adem-photographe',
 'Photographe de mariage haut de gamme à Tunis',
 'Adem capture chaque émotion avec une sensibilité artistique unique. Spécialisé dans le reportage mariage et les portraits de couple, il propose des packages complets incluant la cérémonie, le dîner et la soirée.',
 'adem@photo.tn', '+216 22 111 000', 'Tunis', 'Tunis',
 2500, 8000, 1, 1, 4.9,
 'Adem Photographe Mariage Tunis | PrestaLink', 'Photographe mariage professionnel à Tunis — reportages émouvants et naturels'),

((SELECT id FROM provider_types WHERE slug='photographes'),
 'Studio Lumière Sousse', 'studio-lumiere-sousse',
 'Studio photo & vidéo mariage à Sousse',
 'Studio Lumière réunit une équipe de 3 photographes et 2 vidéastes. Nous proposons des films de mariage cinématographiques en 4K ainsi que des séances photo avant-mariage.',
 'contact@studiolumiere.tn', '+216 73 000 111', 'Sousse', 'Sousse',
 3000, 10000, 1, 1, 4.8,
 'Studio Lumière Sousse — Photo & Vidéo Mariage', 'Studio photo et vidéo mariage à Sousse — films cinématographiques 4K'),

((SELECT id FROM provider_types WHERE slug='photographes'),
 'Hamza Vision', 'hamza-vision',
 'Photographe naturaliste basé à Sfax',
 'Un regard naturel et discret pour capturer l''authenticité de vos moments les plus précieux. Hamza intervient sur toute la Tunisie.',
 'hamza@vision.tn', '+216 98 222 333', 'Sfax', 'Sfax',
 1800, 5000, 0, 1, 4.7,
 'Hamza Vision — Photographe Sfax', 'Photographe naturaliste pour mariages et événements à Sfax');

-- ----------------------------------------------------------------
-- Traiteurs
-- ----------------------------------------------------------------
INSERT INTO providers (type_id, name, slug, short_description, description, email, phone, city, governorate, price_min, price_max, is_featured, is_active, rating, meta_title, meta_description) VALUES
((SELECT id FROM provider_types WHERE slug='traiteurs'),
 'Saveurs du Bosphore', 'saveurs-du-bosphore',
 'Cuisine orientale raffinée pour vos grandes occasions',
 'Saveurs du Bosphore propose une cuisine orientale et méditerranéenne d''exception. Nos chefs préparent des mezze, tajines et grillades pour des tables de 50 à 500 personnes. Vaisselle et personnel inclus.',
 'contact@saveursbosphore.tn', '+216 71 555 666', 'Tunis', 'Tunis',
 8000, 50000, 1, 1, 4.8,
 'Traiteur Mariage Tunis — Saveurs du Bosphore', 'Traiteur cuisine orientale pour mariages et réceptions à Tunis'),

((SELECT id FROM provider_types WHERE slug='traiteurs'),
 'Chef Karim Traiteur', 'chef-karim-traiteur',
 'Gastronomie tunisienne et internationale, Nabeul',
 'Chef Karim et son équipe proposent des buffets gastronomiques alliant authenticité tunisienne et touches internationales. Service complet avec mise en place, service et débarrassage.',
 'karim@traiteur.tn', '+216 72 888 999', 'Nabeul', 'Nabeul',
 6000, 30000, 0, 1, 4.6,
 'Chef Karim Traiteur Nabeul — Gastronomie', 'Traiteur gastronomique pour mariages à Nabeul et environs'),

((SELECT id FROM provider_types WHERE slug='traiteurs'),
 'Le Banquet Royal', 'le-banquet-royal',
 'Traiteur prestige pour événements d''exception à Sfax',
 'Le Banquet Royal est la référence traiteur à Sfax depuis 15 ans. Spécialiste des grandes réceptions, nous prenons en charge jusqu''à 1000 convives avec un service cinq étoiles.',
 'info@banquetroyal.tn', '+216 74 000 555', 'Sfax', 'Sfax',
 10000, 60000, 1, 1, 4.9,
 'Le Banquet Royal — Traiteur Prestige Sfax', 'Traiteur haut de gamme pour mariages et événements à Sfax');

-- ----------------------------------------------------------------
-- Décorateurs
-- ----------------------------------------------------------------
INSERT INTO providers (type_id, name, slug, short_description, description, email, phone, city, governorate, price_min, price_max, is_featured, is_active, rating, meta_title, meta_description) VALUES
((SELECT id FROM provider_types WHERE slug='decorateurs'),
 'Art & Déco Événements', 'art-deco-evenements',
 'Décoration florale et scénographie mariage, Tunis',
 'Notre atelier crée des ambiances uniques et personnalisées pour chaque couple. Arches florales, centres de table, backdrop photo, éclairage d''ambiance — nous transformons votre salle en un décor de rêve.',
 'contact@artdeco.tn', '+216 20 111 222', 'Tunis', 'Tunis',
 3000, 20000, 1, 1, 4.9,
 'Art & Déco Événements Tunis — Décoration Mariage', 'Décorateur mariage Tunis — scénographie florale et lumineuse'),

((SELECT id FROM provider_types WHERE slug='decorateurs'),
 'Bloom Décoration', 'bloom-decoration',
 'Décoration florale contemporaine, Sousse',
 'Bloom crée des compositions florales de saison pour vos tables, arches et bouquets. Style bohème, minimaliste ou luxe — nous nous adaptons à votre vision.',
 'hello@bloom.tn', '+216 73 444 555', 'Sousse', 'Sousse',
 2000, 12000, 0, 1, 4.7,
 'Bloom Décoration Florale Sousse', 'Décoration florale contemporaine pour mariages à Sousse');

-- ----------------------------------------------------------------
-- Animateurs
-- ----------------------------------------------------------------
INSERT INTO providers (type_id, name, slug, short_description, description, email, phone, city, governorate, price_min, price_max, is_featured, is_active, rating, meta_title, meta_description) VALUES
((SELECT id FROM provider_types WHERE slug='animateurs'),
 'DJ Rafik', 'dj-rafik',
 'DJ mariage et soirées privées, toute la Tunisie',
 'DJ Rafik anime vos mariages, soirées et événements d''entreprise depuis 10 ans. Matériel son et lumière professionnel, répertoire oriental, international et électro. Disponible partout en Tunisie.',
 'rafik@dj.tn', '+216 55 777 888', 'Tunis', 'Tunis',
 1500, 6000, 1, 1, 4.8,
 'DJ Rafik — Animation Mariage Tunisie', 'DJ professionnel pour mariages et soirées en Tunisie'),

((SELECT id FROM provider_types WHERE slug='animateurs'),
 'Orchestre El Farah', 'orchestre-el-farah',
 'Orchestre traditionnel et moderne pour mariages',
 'L''orchestre El Farah propose des concerts live mélangeant musique tunisienne traditionnelle et tubes contemporains. Formation de 5 à 12 musiciens selon vos besoins.',
 'elfarah@orchestre.tn', '+216 71 333 444', 'Tunis', 'Tunis',
 3000, 15000, 0, 1, 4.6,
 'Orchestre El Farah — Musique Mariage Tunisie', 'Orchestre live pour mariages tunisiens — musique traditionnelle et moderne');

-- ----------------------------------------------------------------
-- Fleuristes
-- ----------------------------------------------------------------
INSERT INTO providers (type_id, name, slug, short_description, description, email, phone, city, governorate, price_min, price_max, is_featured, is_active, rating, meta_title, meta_description) VALUES
((SELECT id FROM provider_types WHERE slug='fleuristes'),
 'Les Roses de Tunis', 'les-roses-de-tunis',
 'Bouquets et compositions florales haut de gamme',
 'Les Roses de Tunis crée depuis 2010 des bouquets de mariée, centres de table et arches florales de prestige. Fleurs fraîches importées d''Hollande et locales de saison.',
 'contact@rosesdetunis.tn', '+216 71 222 333', 'Tunis', 'Tunis',
 800, 5000, 1, 1, 4.9,
 'Les Roses de Tunis — Fleuriste Mariage', 'Fleuriste mariage Tunis — bouquets et compositions florales de prestige'),

((SELECT id FROM provider_types WHERE slug='fleuristes'),
 'Fleurs & Sens Hammamet', 'fleurs-sens-hammamet',
 'Fleuriste événementiel spécialisé en mariages bohèmes',
 'Fleurs & Sens propose des créations florales bohèmes et champêtres. Couronnes de fleurs, bouquets sauvages, tables de fleurs — pour un mariage authentique et naturel.',
 'fleursens@hammamet.tn', '+216 72 999 000', 'Hammamet', 'Nabeul',
 600, 3500, 0, 1, 4.7,
 'Fleurs & Sens Hammamet — Fleuriste Mariage Bohème', 'Fleuriste bohème pour mariages à Hammamet et Nabeul');

-- ----------------------------------------------------------------
-- Salles de Fêtes
-- ----------------------------------------------------------------
INSERT INTO providers (type_id, name, slug, short_description, description, email, phone, city, governorate, price_min, price_max, is_featured, is_active, rating, meta_title, meta_description) VALUES
((SELECT id FROM provider_types WHERE slug='locations-salles'),
 'Palais des Mille et Une Nuits', 'palais-mille-nuits',
 'Salle de réception de luxe, Tunis Nord',
 'Un cadre somptueux inspiré de l''architecture andalouse pour vos mariages. Capacité de 800 à 1200 personnes, parking privé, climatisation, éclairage architectural, scène et piste de danse. Prestations traiteur disponibles sur demande.',
 'reservations@palais1001.tn', '+216 71 900 800', 'La Marsa', 'Tunis',
 15000, 80000, 1, 1, 4.8,
 'Palais des Mille et Une Nuits — Salle Mariage Tunis', 'Salle de mariage luxueuse à Tunis — capacité 1200 personnes'),

((SELECT id FROM provider_types WHERE slug='locations-salles'),
 'Villa Jasmine Events', 'villa-jasmine-events',
 'Espace événementiel en plein air, Hammamet',
 'Villa Jasmine offre un cadre enchanteur en bord de mer à Hammamet. Jardin illuminé de 2000m², terrasse vue mer, salle intérieure climatisée 400 personnes. Idéal pour mariages en été.',
 'info@villajasmine.tn', '+216 72 700 600', 'Hammamet', 'Nabeul',
 12000, 50000, 1, 1, 4.9,
 'Villa Jasmine Events Hammamet — Mariage Bord de Mer', 'Salle de mariage avec jardin et vue mer à Hammamet'),

((SELECT id FROM provider_types WHERE slug='locations-salles'),
 'Salle El Kods Sfax', 'salle-el-kods-sfax',
 'Grande salle de réception au cœur de Sfax',
 'Salle El Kods accueille vos mariages et réceptions jusqu''à 600 personnes. Équipement son et lumière inclus, scène professionnelle, parking 200 places, vestiaires.',
 'elkods@sfax.tn', '+216 74 500 400', 'Sfax', 'Sfax',
 8000, 35000, 0, 1, 4.6,
 'Salle El Kods Sfax — Location Salle Mariage', 'Location salle de fête à Sfax — capacité 600 personnes');
