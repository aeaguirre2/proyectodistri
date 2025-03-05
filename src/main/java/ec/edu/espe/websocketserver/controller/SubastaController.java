package ec.edu.espe.websocketserver.controller;

import ec.edu.espe.websocketserver.model.*;
import ec.edu.espe.websocketserver.service.SubastaService;
import ec.edu.espe.websocketserver.repository.UsuarioRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;

import java.math.BigDecimal;
import java.util.List;

@RestController
@RequestMapping("/api/subastas")
@CrossOrigin(origins = "*", allowedHeaders = "*", methods = {RequestMethod.GET, RequestMethod.POST, RequestMethod.OPTIONS})
public class SubastaController {

    @Autowired
    private SubastaService subastaService;
    
    @Autowired
    private UsuarioRepository usuarioRepository;

    @PostMapping("/crear")
    public ResponseEntity<?> crearSubasta(@RequestBody SubastaRequest request, Authentication auth) {
        try {
            Usuario vendedor = usuarioRepository.findByUsername(auth.getName())
                .orElseThrow(() -> new IllegalArgumentException("Usuario no encontrado"));
                
            if (vendedor.getTipoUsuario() != Usuario.TipoUsuario.VENDEDOR && 
                vendedor.getTipoUsuario() != Usuario.TipoUsuario.ADMIN) {
                return ResponseEntity.status(403).body("No tiene permisos para crear subastas");
            }
            
            Subasta subasta = new Subasta();
            subasta.setTitulo(request.getTitulo());
            subasta.setDescripcion(request.getDescripcion());
            subasta.setFechaInicio(request.getFechaInicio());
            subasta.setFechaFin(request.getFechaFin());
            subasta.setVendedor(vendedor);
            
            return ResponseEntity.ok(subastaService.crearSubasta(subasta, request.getAutosIds()));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }

    @GetMapping("/activas")
    public ResponseEntity<?> obtenerSubastasActivas() {
        return ResponseEntity.ok(subastaService.obtenerSubastasActivas());
    }

    @GetMapping("/vendedor")
    public ResponseEntity<?> obtenerSubastasVendedor(Authentication auth) {
        try {
            Usuario vendedor = usuarioRepository.findByUsername(auth.getName())
                .orElseThrow(() -> new IllegalArgumentException("Usuario no encontrado"));
            return ResponseEntity.ok(subastaService.obtenerSubastasVendedor(vendedor));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }

    @PostMapping("/{subastaId}/autos/{autoId}/pujar")
    public ResponseEntity<?> realizarPuja(
            @PathVariable Long subastaId,
            @PathVariable Long autoId,
            @RequestBody BigDecimal monto,
            Authentication auth) {
        try {
            Usuario comprador = usuarioRepository.findByUsername(auth.getName())
                .orElseThrow(() -> new IllegalArgumentException("Usuario no encontrado"));
                
            if (comprador.getTipoUsuario() != Usuario.TipoUsuario.COMPRADOR) {
                return ResponseEntity.status(403).body("Solo los compradores pueden realizar pujas");
            }
            
            subastaService.procesarPuja(subastaId, autoId, comprador, monto);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }

    @PostMapping("/{id}/finalizar")
    public ResponseEntity<?> finalizarSubasta(@PathVariable Long id, Authentication auth) {
        try {
            Usuario usuario = usuarioRepository.findByUsername(auth.getName())
                .orElseThrow(() -> new IllegalArgumentException("Usuario no encontrado"));
                
            if (usuario.getTipoUsuario() != Usuario.TipoUsuario.ADMIN) {
                return ResponseEntity.status(403).body("Solo los administradores pueden finalizar subastas");
            }
            
            subastaService.finalizarSubasta(id);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }

    @GetMapping("/admin/finalizadas")
    public ResponseEntity<?> obtenerSubastasFinalizadas(Authentication authentication) {
        try {
            if (authentication == null || !authentication.getAuthorities().stream()
                    .anyMatch(a -> a.getAuthority().equals("ADMIN"))) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body("Acceso denegado: Se requieren permisos de administrador");
            }

            List<Subasta> subastasFinalizadas = subastaService.obtenerSubastasFinalizadas();
            return ResponseEntity.ok(subastasFinalizadas);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body("Error al obtener subastas finalizadas: " + e.getMessage());
        }
    }
} 