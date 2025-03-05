package ec.edu.espe.websocketserver.service;

import ec.edu.espe.websocketserver.model.*;
import ec.edu.espe.websocketserver.repository.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import lombok.extern.slf4j.Slf4j;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;
import java.util.Map;

@Service
@Slf4j
public class SubastaService {

    @Autowired
    private SubastaRepository subastaRepository;
    
    @Autowired
    private AutoRepository autoRepository;
    
    @Autowired
    private AutoSubastaRepository autoSubastaRepository;
    
    @Autowired
    private UsuarioRepository usuarioRepository;
    
    @Autowired
    private PujaRepository pujaRepository;
    
    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    @Scheduled(fixedRate = 60000) // Ejecutar cada minuto
    @Transactional
    public void verificarSubastasVencidas() {
        log.info("Verificando subastas vencidas...");
        List<Subasta> subastasActivas = subastaRepository.findByActivaTrueAndCanceladaFalseAndFechaFinBefore(LocalDateTime.now());
        
        for (Subasta subasta : subastasActivas) {
            try {
                finalizarSubasta(subasta.getId());
                log.info("Subasta {} finalizada automáticamente", subasta.getId());
            } catch (Exception e) {
                log.error("Error al finalizar subasta {}: {}", subasta.getId(), e.getMessage());
            }
        }
    }

    @Transactional
    public Subasta crearSubasta(Subasta subasta, List<Long> autoIds) {
        if (subasta.getFechaInicio() == null) {
            subasta.setFechaInicio(LocalDateTime.now());
        }
        
        if (subasta.getFechaFin() == null) {
            subasta.setFechaFin(subasta.getFechaInicio().plusHours(24)); // Por defecto 24 horas
        }
        
        if (subasta.getFechaFin().isBefore(subasta.getFechaInicio())) {
            throw new IllegalArgumentException("La fecha de fin debe ser posterior a la fecha de inicio");
        }
        
        if (autoIds == null || autoIds.isEmpty()) {
            throw new IllegalArgumentException("Debe seleccionar al menos un auto para la subasta");
        }
        
        List<Auto> autos = autoRepository.findAllById(autoIds);
        
        // Validar que los autos no estén vendidos o en otra subasta activa
        for (Auto auto : autos) {
            if (auto.isVendido()) {
                throw new IllegalArgumentException("El auto " + auto.getMarca() + " " + auto.getModelo() + " ya está vendido");
            }
            if (auto.isEnSubasta()) {
                throw new IllegalArgumentException("El auto " + auto.getMarca() + " " + auto.getModelo() + " ya está en otra subasta");
            }
        }
        
        subasta.setActiva(true);
        subasta.setCancelada(false);
        subasta.setFinalizada(false);
        
        Subasta subastaGuardada = subastaRepository.save(subasta);
        
        // Crear AutoSubasta para cada auto
        for (Auto auto : autos) {
            AutoSubasta autoSubasta = new AutoSubasta();
            autoSubasta.setAuto(auto);
            autoSubasta.setSubasta(subastaGuardada);
            autoSubasta.setPrecioFinal(auto.getPrecioBase());
            autoSubastaRepository.save(autoSubasta);
            
            // Actualizar estado del auto
            auto.setEnSubasta(true);
            autoRepository.save(auto);
        }
        
        return subastaGuardada;
    }

    public List<Subasta> obtenerSubastasActivas() {
        return subastaRepository.findByActivaTrueAndCanceladaFalseAndFechaFinAfter(LocalDateTime.now());
    }

    public List<Subasta> obtenerSubastasVendedor(Usuario vendedor) {
        return subastaRepository.findByVendedor(vendedor);
    }

    @Transactional
    public void procesarPuja(Long subastaId, Long autoId, Usuario comprador, BigDecimal monto) {
        Subasta subasta = subastaRepository.findById(subastaId)
            .orElseThrow(() -> new IllegalArgumentException("Subasta no encontrada"));
            
        if (!subasta.isActiva() || subasta.isCancelada()) {
            throw new IllegalArgumentException("La subasta no está activa");
        }
        
        if (LocalDateTime.now().isBefore(subasta.getFechaInicio())) {
            throw new IllegalArgumentException("La subasta aún no ha comenzado");
        }
        
        if (LocalDateTime.now().isAfter(subasta.getFechaFin())) {
            throw new IllegalArgumentException("La subasta ya ha finalizado");
        }
        
        AutoSubasta autoSubasta = autoSubastaRepository.findBySubastaIdAndAutoId(subastaId, autoId)
            .orElseThrow(() -> new IllegalArgumentException("Auto no encontrado en la subasta"));
            
        if (autoSubasta.isVendido()) {
            throw new IllegalArgumentException("Este auto ya ha sido vendido");
        }
        
        // Validar que el comprador no sea el vendedor
        if (comprador.getId().equals(subasta.getVendedor().getId())) {
            throw new IllegalArgumentException("El vendedor no puede pujar por sus propios autos");
        }
        
        // Validar monto mínimo
        BigDecimal ultimaPuja = pujaRepository.findTopByAutoSubastaOrderByMontoDesc(autoSubasta)
            .map(Puja::getMonto)
            .orElse(autoSubasta.getAuto().getPrecioBase());
            
        if (monto.compareTo(ultimaPuja) <= 0) {
            throw new IllegalArgumentException("El monto debe ser mayor a la última puja");
        }

        // Nuevas validaciones para detectar comportamientos sospechosos
        
        // 1. Verificar si el usuario ha realizado muchas pujas en poco tiempo
        int pujasRecientes = pujaRepository.countByCompradorAndFechaAfter(
            comprador, 
            LocalDateTime.now().minusMinutes(5)
        );
        if (pujasRecientes > 10) {
            throw new IllegalArgumentException("Ha realizado demasiadas pujas en poco tiempo. Por favor espere unos minutos.");
        }
        
        // 2. Verificar si el incremento es sospechosamente alto
        BigDecimal incrementoMaximo = ultimaPuja.multiply(new BigDecimal("2"));
        if (monto.compareTo(incrementoMaximo) > 0) {
            log.warn("Puja sospechosamente alta detectada: Usuario {} en subasta {}", comprador.getUsername(), subastaId);
            // Notificar al administrador
            messagingTemplate.convertAndSendToUser(
                "admin",
                "/queue/alerts",
                Map.of(
                    "type", "SUSPICIOUS_BID",
                    "message", "Puja sospechosamente alta detectada",
                    "details", Map.of(
                        "usuario", comprador.getUsername(),
                        "subastaId", subastaId,
                        "monto", monto,
                        "ultimaPuja", ultimaPuja
                    )
                )
            );
        }
        
        // 3. Verificar si es la primera puja del usuario
        boolean esPrimeraPuja = !pujaRepository.existsByCompradorAndAutoSubasta(comprador, autoSubasta);
        if (esPrimeraPuja && monto.compareTo(ultimaPuja.multiply(new BigDecimal("1.5"))) > 0) {
            log.warn("Primera puja sospechosamente alta detectada: Usuario {} en subasta {}", comprador.getUsername(), subastaId);
        }

        // Crear y guardar la puja
        Puja puja = new Puja();
        puja.setAutoSubasta(autoSubasta);
        puja.setComprador(comprador);
        puja.setMonto(monto);
        puja.setFecha(LocalDateTime.now());
        pujaRepository.save(puja);
        
        // Actualizar el precio final en AutoSubasta
        autoSubasta.setPrecioFinal(monto);
        autoSubastaRepository.save(autoSubasta);
        
        // Notificar a todos los usuarios sobre la nueva puja
        messagingTemplate.convertAndSend("/topic/subastas/" + subastaId, 
            Map.of(
                "type", "NEW_BID",
                "subastaId", subastaId,
                "autoId", autoId,
                "monto", monto
            )
        );
    }

    @Transactional
    public void finalizarSubasta(Long subastaId) {
        Subasta subasta = subastaRepository.findById(subastaId)
            .orElseThrow(() -> new IllegalArgumentException("Subasta no encontrada"));
            
        if (!subasta.isActiva() || subasta.isFinalizada()) {
            throw new IllegalArgumentException("La subasta ya está finalizada");
        }
        
        subasta.setActiva(false);
        subasta.setFinalizada(true);
        
        // Procesar cada auto en la subasta
        for (AutoSubasta autoSubasta : subasta.getAutos()) {
            List<Puja> pujas = pujaRepository.findByAutoSubasta(autoSubasta);
            Puja ultimaPuja = pujas.stream()
                .max((p1, p2) -> p1.getMonto().compareTo(p2.getMonto()))
                .orElse(null);
                
            Auto auto = autoSubasta.getAuto();
            
            if (ultimaPuja != null && ultimaPuja.getMonto().compareTo(auto.getPrecioBase()) >= 0) {
                // Venta exitosa
                auto.setVendido(true);
                auto.setComprador(ultimaPuja.getComprador());
                autoSubasta.setVendido(true);
                autoSubasta.setPrecioFinal(ultimaPuja.getMonto());
                ultimaPuja.setGanadora(true);
            } else {
                // No se alcanzó el precio mínimo
                auto.setEnSubasta(false);
            }
            
            autoRepository.save(auto);
            autoSubastaRepository.save(autoSubasta);
            if (ultimaPuja != null) {
                pujaRepository.save(ultimaPuja);
            }
        }
        
        subastaRepository.save(subasta);
    }

    public List<Subasta> obtenerSubastasFinalizadas() {
        return subastaRepository.findByEstadoOrderByFechaFinDesc("FINALIZADA");
    }
} 