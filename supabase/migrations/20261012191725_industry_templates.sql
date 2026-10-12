-- Branche-templates: velddefinities die elk bedrijf in die branche erft.
-- Een bedrijf kan eigen velden toevoegen met tenant_id gevuld.

insert into public.field_definitions (industry, entity, key, label, data_type, options, required, position) values
  -- Schilder
  ('schilder', 'quote_line', 'oppervlakte_m2', 'Oppervlakte',    'number', '{"unit": "m2", "min": 0}', false, 10),
  ('schilder', 'quote_line', 'ondergrond',     'Ondergrond',     'enum',   '{"values": ["hout", "steen", "metaal", "gips", "kunststof"]}', false, 20),
  ('schilder', 'quote_line', 'aantal_lagen',   'Aantal lagen',   'number', '{"min": 1, "max": 5}', false, 30),
  ('schilder', 'quote_line', 'kleurcode',      'Kleurcode',      'text',   '{}', false, 40),
  ('schilder', 'job',        'binnen_buiten',  'Binnen/buiten',  'enum',   '{"values": ["binnen", "buiten", "beide"]}', true, 10),

  -- Tuinarchitect / hovenier
  ('tuin', 'job',        'grondsoort',            'Grondsoort',            'enum',   '{"values": ["zand", "klei", "veen", "leem"]}', false, 10),
  ('tuin', 'job',        'oppervlakte_tuin_m2',   'Oppervlakte tuin',      'number', '{"unit": "m2", "min": 0}', false, 20),
  ('tuin', 'job',        'onderhoudsfrequentie',  'Onderhoudsfrequentie',  'enum',   '{"values": ["eenmalig", "maandelijks", "per kwartaal", "jaarlijks"]}', false, 30),
  ('tuin', 'quote_line', 'plantsoort',            'Plantsoort',            'text',   '{}', false, 10),

  -- Timmerman
  ('timmer', 'quote_line', 'houtsoort',    'Houtsoort',          'enum',   '{"values": ["vuren", "eiken", "meranti", "accoya", "plaatmateriaal"]}', false, 10),
  ('timmer', 'quote_line', 'afmetingen',   'Afmetingen (LxBxH)', 'text',   '{"unit": "mm"}', false, 20),
  ('timmer', 'quote_line', 'montage',      'Inclusief montage',  'bool',   '{}', false, 30),
  ('timmer', 'job',        'vergunning',   'Vergunning nodig',   'bool',   '{}', false, 10);
