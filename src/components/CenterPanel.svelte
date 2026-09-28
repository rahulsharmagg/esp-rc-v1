<script lang="ts">
  import type { BLEController } from '../lib/ble.svelte';
  import RadarGauge from './RadarGauge.svelte';
  import Actuators from './Actuators.svelte';
  import ThrottleQuadrant from './ThrottleQuadrant.svelte';

  interface Props {
    ble: BLEController;
  }

  let { ble }: Props = $props();
</script>

<section class="panel-center">
  <!-- Ultrasonic Distance Radar -->
  <RadarGauge {ble} />

  <!-- Actuator Buttons: Lights & Horn -->
  <Actuators {ble} />

  <!-- Dynamic Throttle Quadrant -->
  <ThrottleQuadrant {ble} />
</section>
