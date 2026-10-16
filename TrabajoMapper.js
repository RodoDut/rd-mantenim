/**
 * TrabajoMapper.gs — conversión de la entidad Trabajo (claves neutras, ver Ports.gs) al DTO que
 * consume el cliente. No conoce la planilla: la traducción fila <-> entidad vive en el adaptador
 * (TrabajoRepository.gs).
 */
const TrabajoMapper = {
  /** @param {Trabajo} t */
  toDto(t) {
        return {
          id: t.id,
          creadoEn: t.creadoEn,
          fecha: t.fecha,
          equipo: t.equipo,
          personal: t.personal.join(', '),
          descripcion: t.descripcion,
          imagen: t.imagenUrl
     };
    }
};
