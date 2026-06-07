export interface ProvinceInfo {
  pcode: string;
  name: string;
  capital: string;
  region: 'ouest' | 'centre' | 'est' | 'nord' | 'sud';
}

export const RDC_PROVINCES: ProvinceInfo[] = [
  { pcode: 'CD01', name: 'Kinshasa',       capital: 'Kinshasa',       region: 'ouest'  },
  { pcode: 'CD02', name: 'Kongo-Central',  capital: 'Matadi',         region: 'ouest'  },
  { pcode: 'CD03', name: 'Kwango',         capital: 'Kenge',          region: 'ouest'  },
  { pcode: 'CD04', name: 'Kwilu',          capital: 'Bandundu',       region: 'ouest'  },
  { pcode: 'CD05', name: 'Maï-Ndombe',     capital: 'Inongo',         region: 'centre' },
  { pcode: 'CD06', name: 'Kasaï',          capital: 'Luebo',          region: 'centre' },
  { pcode: 'CD07', name: 'Kasaï-Central',  capital: 'Kananga',        region: 'centre' },
  { pcode: 'CD08', name: 'Kasaï-Oriental', capital: 'Mbuji-Mayi',     region: 'centre' },
  { pcode: 'CD09', name: 'Lomami',         capital: 'Kabinda',        region: 'centre' },
  { pcode: 'CD10', name: 'Sankuru',        capital: 'Lusambo',        region: 'centre' },
  { pcode: 'CD11', name: 'Maniema',        capital: 'Kindu',          region: 'est'    },
  { pcode: 'CD12', name: 'Sud-Kivu',       capital: 'Bukavu',         region: 'est'    },
  { pcode: 'CD14', name: 'Nord-Kivu',      capital: 'Goma',           region: 'est'    },
  { pcode: 'CD15', name: 'Ituri',          capital: 'Bunia',          region: 'est'    },
  { pcode: 'CD16', name: 'Haut-Uélé',      capital: 'Isiro',          region: 'nord'   },
  { pcode: 'CD17', name: 'Tshopo',         capital: 'Kisangani',      region: 'nord'   },
  { pcode: 'CD18', name: 'Bas-Uélé',       capital: 'Buta',           region: 'nord'   },
  { pcode: 'CD19', name: 'Nord-Ubangi',    capital: 'Gbadolite',      region: 'nord'   },
  { pcode: 'CD20', name: 'Mongala',        capital: 'Lisala',         region: 'nord'   },
  { pcode: 'CD21', name: 'Sud-Ubangi',     capital: 'Gemena',         region: 'nord'   },
  { pcode: 'CD22', name: 'Équateur',       capital: 'Mbandaka',       region: 'nord'   },
  { pcode: 'CD23', name: 'Tshuapa',        capital: 'Boende',         region: 'nord'   },
  { pcode: 'CD24', name: 'Tanganyika',     capital: 'Kalemie',        region: 'sud'    },
  { pcode: 'CD25', name: 'Haut-Lomami',    capital: 'Kamina',         region: 'sud'    },
  { pcode: 'CD26', name: 'Lualaba',        capital: 'Kolwezi',        region: 'sud'    },
  { pcode: 'CD27', name: 'Haut-Katanga',   capital: 'Lubumbashi',     region: 'sud'    },
];

export function getProvinceByPcode(pcode: string): ProvinceInfo | undefined {
  return RDC_PROVINCES.find((p) => p.pcode === pcode);
}
