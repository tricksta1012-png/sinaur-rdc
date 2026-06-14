-- Seed 007 — 17e épidémie Ebola RDC · Souche Bundibugyo
-- Source : INSP SitRep N°17 · OMS · Radio Okapi · 8 juin 2026
-- Déclarée le 15 mai 2026 · USPPI OMS le 17 mai 2026

TRUNCATE epidemic_zone, epidemic_timeseries RESTART IDENTITY CASCADE;

INSERT INTO epidemic_zone (
  maladie, souche, zone_sante, territoire, province, p_code,
  coordinates, cas_confirmes, cas_suspects, deces_confirmes,
  deces_suspects, statut, date_premier_cas, derniere_mise_a_jour,
  groupes_armes_actifs, acces_humanitaire, source
) VALUES

-- ITURI (épicentre)
('EBOLA','Bundibugyo','Bunia',     'Bunia',   'Ituri','CD-IT-BN',
 ST_SetSRID(ST_MakePoint(30.25,1.56),4326),
 142,89,28,34,'ACTIF','2026-05-12',NOW(),'{"CODECO":true,"ADF":false}','PARTIEL','INSP SitRep 17'),

('EBOLA','Bundibugyo','Rwampara',  'Bunia',   'Ituri','CD-IT-RW',
 ST_SetSRID(ST_MakePoint(30.31,1.48),4326),
 98,67,19,28,'ACTIF','2026-05-12',NOW(),'{}','BON','INSP SitRep 17'),

('EBOLA','Bundibugyo','Mongbwalu', 'Djugu',   'Ituri','CD-IT-MG',
 ST_SetSRID(ST_MakePoint(30.02,1.95),4326),
 76,54,14,22,'ACTIF','2026-05-13',NOW(),'{"CODECO":true}','DIFFICILE','INSP SitRep 17'),

('EBOLA','Bundibugyo','Mambasa',   'Mambasa', 'Ituri','CD-IT-MB',
 ST_SetSRID(ST_MakePoint(29.04,1.20),4326),
 34,28,8,11,'ACTIF','2026-05-18',NOW(),'{"ADF":true}','BLOQUE','INSP SitRep 17'),

('EBOLA','Bundibugyo','Komanda',   'Mambasa', 'Ituri','CD-IT-KO',
 ST_SetSRID(ST_MakePoint(29.74,1.43),4326),
 28,19,5,9,'ACTIF','2026-05-20',NOW(),'{"ADF":true}','BLOQUE','INSP SitRep 17'),

('EBOLA','Bundibugyo','Nyankunde', 'Irumu',   'Ituri','CD-IT-NY',
 ST_SetSRID(ST_MakePoint(30.42,1.18),4326),
 22,15,4,7,'ACTIF','2026-05-21',NOW(),'{}','BON','INSP SitRep 17'),

('EBOLA','Bundibugyo','Logo',      'Aru',     'Ituri','CD-IT-LO',
 ST_SetSRID(ST_MakePoint(30.75,3.60),4326),
 18,12,3,5,'ACTIF','2026-05-28',NOW(),'{}','BON','INSP SitRep 17'),

('EBOLA','Bundibugyo','Nizi',      'Djugu',   'Ituri','CD-IT-NI',
 ST_SetSRID(ST_MakePoint(30.12,2.10),4326),
 15,10,3,4,'ACTIF','2026-05-29',NOW(),'{"CODECO":true}','DIFFICILE','INSP SitRep 17'),

('EBOLA','Bundibugyo','Aungba',    'Aru',     'Ituri','CD-IT-AU',
 ST_SetSRID(ST_MakePoint(30.52,3.42),4326),
 12,8,2,3,'ACTIF','2026-05-31',NOW(),'{}','BON','INSP SitRep 17'),

-- NORD-KIVU
('EBOLA','Bundibugyo','Butembo',   'Butembo', 'Nord-Kivu','CD-NK-BT',
 ST_SetSRID(ST_MakePoint(29.29,0.13),4326),
 32,24,6,9,'ACTIF','2026-05-22',NOW(),'{"ADF":true}','PARTIEL','INSP SitRep 17'),

('EBOLA','Bundibugyo','Beni',      'Beni',    'Nord-Kivu','CD-NK-BE',
 ST_SetSRID(ST_MakePoint(29.47,0.50),4326),
 24,18,4,7,'ACTIF','2026-05-23',NOW(),'{"ADF":true}','DIFFICILE','INSP SitRep 17'),

('EBOLA','Bundibugyo','Goma',      'Nyiragongo','Nord-Kivu','CD-NK-GO',
 ST_SetSRID(ST_MakePoint(29.23,-1.68),4326),
 8,6,1,2,'ACTIF','2026-05-26',NOW(),'{"M23_AFC":true}','PARTIEL','INSP SitRep 17'),

('EBOLA','Bundibugyo','Oicha',     'Beni',    'Nord-Kivu','CD-NK-OI',
 ST_SetSRID(ST_MakePoint(29.52,0.71),4326),
 14,10,3,4,'ACTIF','2026-05-25',NOW(),'{"ADF":true}','BLOQUE','INSP SitRep 17'),

-- SUD-KIVU
('EBOLA','Bundibugyo','Uvira',     'Uvira',   'Sud-Kivu','CD-SK-UV',
 ST_SetSRID(ST_MakePoint(29.13,-3.39),4326),
 3,4,0,1,'ALERTE','2026-06-02',NOW(),'{"Twirwaneho":true}','DIFFICILE','INSP SitRep 17');

-- Courbe épidémique cumulée
INSERT INTO epidemic_timeseries (
  maladie, souche, date_rapport,
  cas_confirmes_cumul, cas_suspects_cumul,
  deces_confirmes_cumul, deces_suspects_cumul,
  nouvelles_zones, source
) VALUES
('EBOLA','Bundibugyo','2026-05-15',   8,  80,  1, 20,  3,'INSP'),
('EBOLA','Bundibugyo','2026-05-17',  10, 180,  2, 50,  4,'INSP'),
('EBOLA','Bundibugyo','2026-05-20',  51, 600,  5,139,  7,'INSP'),
('EBOLA','Bundibugyo','2026-05-23',  80, 700, 10,160,  9,'INSP'),
('EBOLA','Bundibugyo','2026-05-27', 140, 800, 20,190, 11,'INSP'),
('EBOLA','Bundibugyo','2026-05-31', 282,1000, 42,220, 17,'INSP'),
('EBOLA','Bundibugyo','2026-06-08', 515,1200, 91,300, 25,'INSP');
